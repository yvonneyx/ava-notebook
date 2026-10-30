import { readFile, writeFile, rename, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createOpenAI } from '@ai-sdk/openai';
let recordings = JSON.parse(
  await readFile(
    new URL('../examples/classic/recordings.json', import.meta.url),
    'utf8',
  ),
);
const live = process.argv.includes('--live');
const key = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL;
if (live && (!key || !modelName))
  throw new Error('Live generation requires OPENAI_API_KEY and OPENAI_MODEL');
const endpoint = live ? new URL(process.env.OPENAI_BASE_URL) : undefined;
if (live && endpoint.protocol !== 'https:')
  throw new Error('Live generation requires an HTTPS model endpoint');
const model = live
  ? createOpenAI({
      apiKey: key,
      baseURL: endpoint.href,
      fetch: (input, options) => {
        const destination = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (destination.origin !== endpoint.origin)
          throw new Error('Unexpected model request origin');
        return fetch(input, { ...options, redirect: 'error' });
      },
    }).chat(modelName)
  : undefined;
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'warn',
});
let browser;
const resumeIndex = process.argv.indexOf('--resume');
const resume =
  resumeIndex >= 0
    ? JSON.parse(await readFile(process.argv[resumeIndex + 1], 'utf8'))
    : undefined;
if (resume && (!live || resume.modelName !== modelName))
  throw new Error('Resume requires the same live model');
const cases = resume?.cases || [];
if (resume) recordings = resume.recordings;
const checkpoint = live
  ? join(await mkdtemp(join(tmpdir(), 'ava-case-generation-')), 'progress.json')
  : undefined;
if (checkpoint) console.log(`Checkpoint: ${checkpoint}`);
const modelResponses = resume?.modelResponses || {};
const pendingCalls = new Map();
const controllers = new Set();
let writes = Promise.resolve();
function saveProgress() {
  const json =
    JSON.stringify({ modelName, cases, recordings, modelResponses }, null, 2) +
    '\n';
  writes = writes.then(() => writeFile(checkpoint, json));
  return writes;
}
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  await page.exposeFunction('callCaseModel', async (options) => {
    const hash = createHash('sha256')
      .update(JSON.stringify(options.prompt))
      .digest('hex');
    const loop = JSON.stringify(options.prompt).includes(
      '# 1. RESPONSE PROTOCOL',
    );
    const textOf = (response) =>
      response.content.map((part) => part.text || '').join('');
    const valid = (text) =>
      !loop || /^\[(EXPLORE|REFINE|SQL|CONFIRM)\]/.test(text.trim());
    const repair = (text, feedback) => [
      ...options.prompt,
      { role: 'assistant', content: [{ type: 'text', text }] },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              feedback ||
              '上一条回复缺少合法动作开头，运行器尚未确认本轮完成。请重发本轮回复，必须以 [EXPLORE]、[REFINE]、[SQL] 或 [CONFIRM] 之一开头，每轮只返回一个动作。如果已经完成核验，请直接使用 [CONFIRM] 并完整重述中文结论、数据依据、建议和限制，不要仅说已完成或引用上一条回复。',
          },
        ],
      },
    ];
    const cached = modelResponses[hash];
    if (cached && valid(textOf(cached)) && !cached.reviewFeedback)
      return cached;
    let prompt = cached
      ? repair(textOf(cached), cached.reviewFeedback)
      : options.prompt;
    if (pendingCalls.has(hash)) return pendingCalls.get(hash);
    const request = (async () => {
      for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const { stream } = await model.doStream({
            ...options,
            prompt,
            abortSignal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(180000),
            ]),
          });
          let text = '',
            finish,
            warnings = [];
          for await (const part of stream) {
            if (part.type === 'text-delta') text += part.delta;
            else if (part.type === 'stream-start') warnings = part.warnings;
            else if (part.type === 'finish') finish = part;
            else if (part.type === 'error') throw part.error;
          }
          if (!finish)
            throw Object.assign(
              new Error('Model stream ended before completion'),
              { isRetryable: true },
            );
          if (!valid(text)) {
            prompt = repair(text);
            throw Object.assign(new Error('Invalid Loop action format'), {
              isRetryable: true,
              formatError: true,
            });
          }
          const response = {
            content: [{ type: 'text', text }],
            usage: finish.usage,
            finishReason: finish.finishReason,
            warnings,
          };
          modelResponses[hash] = response;
          await saveProgress();
          return response;
        } catch (error) {
          if (attempt < 2 && error.isRetryable === true) {
            console.log(
              error.formatError
                ? 'Requesting a valid Loop action from the model'
                : 'Temporary model connection failure; retrying',
            );
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * (attempt + 1)),
            );
            continue;
          }
          throw new Error(
            String(error.message)
              .split(key || '\0')
              .join('[redacted]')
              .slice(0, 1000),
          );
        } finally {
          controllers.delete(controller);
        }
      }
    })();
    pendingCalls.set(hash, request);
    try {
      return await request;
    } finally {
      pendingCalls.delete(hash);
    }
  });
  await page.exposeFunction('caseProgress', (message) => console.log(message));
  await page.goto(server.resolvedUrls.local[0] + 'tests/browser/engine.html');
  await page.waitForFunction(() => !!window.MockLanguageModelV4);

  for (const recording of recordings) {
    if (cases.some((run) => run.id === recording.id)) {
      console.log(`${recording.id}: reusing completed case`);
      continue;
    }
    console.log(
      `${recording.id}: ${live ? 'running with ' + modelName : 'replaying'}`,
    );
    const csv = await readFile(new URL(recording.csv, import.meta.url), 'utf8');
    const { run, responses, visualizations } = await page.evaluate(
      async ({ recording, csv, live, modelName }) => {
        const {
          AVA,
          bundles,
          MockLanguageModelV4,
          readCSV,
          putNode,
          applyEvent,
          completeRun,
          eventNodeId,
          createVisualizationQueue,
        } = window;
        const source = {
          ...(await readCSV(new File([csv], recording.name))),
          ...(recording.semantic ? { semantic: recording.semantic } : {}),
        };
        const run = {
          id: recording.id,
          strategy: recording.strategy,
          question: recording.question,
          source,
          model: live ? `${modelName}（录制回放）` : recording.model,
          caseStudy: recording.caseStudy,
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revision: 1,
          nodes: [],
          events: [],
        };
        let index = 0;
        const responses = [];
        const visualizations = {};
        async function complete(kind, options) {
          const hash = Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(JSON.stringify(options.prompt)),
              ),
            ),
          )
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
          const replay =
            kind === 'analysis'
              ? recording.responses[index++]
              : recording.visualizations?.[hash];
          if (!live && replay === undefined)
            throw new Error(`Missing recorded ${kind} response`);
          const result = live
            ? await window.callCaseModel({ ...options, abortSignal: undefined })
            : {
                content: [{ type: 'text', text: replay }],
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: {
                  inputTokens: { total: 0 },
                  outputTokens: { total: 0 },
                },
                warnings: [],
              };
          const text = result.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('');
          if (kind === 'analysis') responses.push(text);
          else visualizations[hash] = text;
          return result;
        }
        const model = new MockLanguageModelV4({
          doGenerate: (options) => complete('analysis', options),
        });
        const chartModel = new MockLanguageModelV4({
          doGenerate: (options) => complete('visualization', options),
        });
        const charts = createVisualizationQueue(
          { model: chartModel, maxRetries: 0 },
          run.question,
          (id, visualization) => {
            const node = run.nodes.find((node) => node.id === id);
            if (node) node.visualization = visualization;
            void window.caseProgress(
              `${run.id}: chart ${visualization.status}`,
            );
          },
          live ? 180000 : 60000,
        );
        const queries = new Map();
        const ava = new AVA({
          llm: { model, maxRetries: 0 },
          engine: { type: 'duckdb-wasm', bundles },
        });
        putNode(run, 'source', {
          kind: 'source',
          title: source.name,
          status: 'running',
          payload: source,
          parents: [],
        });
        ava.on('*', (raw) => {
          const event = {
            ...structuredClone(raw),
            sequence: run.events.length,
            at: new Date().toISOString(),
            nodeId: eventNodeId(raw),
          };
          run.events.push(event);
          applyEvent(run, event);
          const pair = event.context?.eventId?.replace(/:(start|end)$/, '');
          if (event.type === 'querystart') queries.set(pair, event.data.dsl);
          if (
            event.type === 'queryend' &&
            !event.data?.error &&
            event.data?.data?.length
          )
            charts.add(
              event.context.eventId,
              event.data.data,
              queries.get(pair) || '',
            );
          if (event.type === 'stepend')
            void window.caseProgress(
              `${run.id}: step ${event.data.step + 1} ${
                event.data.action || ''
              }`,
            );
        });
        try {
          await ava.source({ type: 'csv', options: { csv } });
          const schema = await ava.schema();
          const semantic = recording.semantic
            ? await ava.semantic(undefined, () => recording.semantic.definition)
            : undefined;
          const profile = await ava.profile({
            metrics: ['row_count', 'null_count'],
          });
          putNode(run, 'context', {
            kind: 'context',
            title: '结构与数据质量',
            status: 'succeeded',
            parents: ['source'],
            payload: { schema, ...(semantic ? { semantic } : {}), profile },
          });
          const result = await ava.analyze(run.question, {
            strategy:
              run.strategy === 'loop'
                ? {
                    type: 'loop',
                    maxSteps: live ? 12 : recording.responses.length,
                  }
                : { type: 'direct' },
            maxRows: 200,
            maxResultBytes: 1024 * 1024,
          });
          completeRun(run, result);
          if (!live && index !== recording.responses.length)
            throw new Error(
              'Recording ended before all responses were consumed',
            );
          run.updatedAt = new Date().toISOString();
          await charts.finish();
          for (const node of run.nodes.filter(
            (node) => node.kind === 'result' && node.payload.data?.length,
          ))
            if (
              node.visualization?.status !== 'ready' &&
              node.visualization?.status !== 'empty'
            )
              throw new Error(
                `Chart generation failed: ${
                  node.visualization?.error || node.id
                }`,
              );
          if (
            !run.nodes.find((node) => node.kind === 'conclusion')?.payload
              .conclusion
          )
            throw new Error('Case did not reach a confirmed conclusion');
          return { run, responses, visualizations };
        } finally {
          await ava.dispose();
        }
      },
      { recording, csv, live, modelName },
    );
    cases.push(run);
    if (live) {
      Object.assign(recording, { model: run.model, responses, visualizations });
      await saveProgress();
    }
    console.log(
      `${run.id}: ${run.nodes.length} nodes, ${run.events.length} events`,
    );
  }
  const destination = new URL(
    '../examples/classic/generated/cases.json',
    import.meta.url,
  );
  if (process.argv.includes('--check')) {
    const saved = JSON.parse(await readFile(destination, 'utf8'));
    assert.deepEqual(
      cases.map((run) => run.id),
      saved.map((run) => run.id),
    );
    for (const run of cases) {
      const previous = saved.find((item) => item.id === run.id);
      assert.equal(run.status, 'completed');
      assert.deepEqual(run.result.data, previous.result.data, run.id);
      const conclusion = (item) =>
        item.nodes.find((node) => node.kind === 'conclusion')?.payload
          .conclusion;
      assert.equal(conclusion(run), conclusion(previous), run.id);
      const data = (item) =>
        item.nodes
          .filter((node) => node.kind === 'result')
          .map((node) => node.payload.data);
      assert.deepEqual(
        JSON.parse(JSON.stringify(data(run))),
        data(previous),
        run.id,
      );
      const queries = (item) =>
        item.nodes
          .filter((node) => node.kind === 'query')
          .map((node) => node.payload.sql);
      assert.deepEqual(queries(run), queries(previous), run.id);
      const charts = (item) =>
        item.nodes
          .filter((node) => node.kind === 'result')
          .map((node) => node.visualization);
      assert.deepEqual(
        JSON.parse(JSON.stringify(charts(run))),
        charts(previous),
        run.id,
      );
    }
    console.log(
      'All classic cases and charts match the saved results using DuckDB-Wasm.',
    );
  } else {
    const temporary = new URL(destination.href + '.tmp');
    await writeFile(temporary, JSON.stringify(cases, null, 2) + '\n');
    if (live) {
      const path = new URL(
        '../examples/classic/recordings.json',
        import.meta.url,
      );
      const pending = new URL(path.href + '.tmp');
      await writeFile(pending, JSON.stringify(recordings, null, 2) + '\n');
      await rename(pending, path);
    }
    await rename(temporary, destination);
  }
} finally {
  for (const controller of controllers) controller.abort();
  await writes;
  await browser?.close();
  await server.close();
}
