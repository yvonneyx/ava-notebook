import { readFile, writeFile, rename } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const recordings = JSON.parse(
  await readFile(
    new URL('../examples/classic/recordings.json', import.meta.url),
    'utf8',
  ),
);
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'warn',
});
let browser;
const cases = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0] + 'tests/browser/engine.html');
  await page.waitForFunction(() => !!window.MockLanguageModelV4);

  for (const recording of recordings) {
    const csv = await readFile(new URL(recording.csv, import.meta.url), 'utf8');
    const run = await page.evaluate(
      async ({ recording, csv }) => {
        const {
          AVA,
          bundles,
          MockLanguageModelV4,
          readCSV,
          putNode,
          applyEvent,
          completeRun,
          eventNodeId,
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
          model: recording.model,
          caseStudy: recording.caseStudy,
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revision: 1,
          nodes: [],
          events: [],
        };
        let index = 0;
        const model = new MockLanguageModelV4({
          doGenerate: async () => {
            const text = recording.responses[index++];
            if (text === undefined)
              throw new Error('Recorded model responses exhausted');
            return {
              content: [{ type: 'text', text }],
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
              warnings: [],
            };
          },
        });
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
                ? { type: 'loop', maxSteps: recording.responses.length }
                : { type: 'direct' },
            maxRows: 200,
            maxResultBytes: 1024 * 1024,
          });
          completeRun(run, result);
          if (index !== recording.responses.length)
            throw new Error(
              'Recording ended before all responses were consumed',
            );
          run.updatedAt = new Date().toISOString();
          return run;
        } finally {
          await ava.dispose();
        }
      },
      { recording, csv },
    );
    cases.push(run);
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
      assert.equal(run.result.conclusion, previous.result.conclusion, run.id);
      const queries = (item) =>
        item.nodes
          .filter((node) => node.kind === 'query')
          .map((node) => node.payload.sql);
      assert.deepEqual(queries(run), queries(previous), run.id);
    }
    console.log('All classic cases match the saved results using DuckDB-Wasm.');
  } else {
    const temporary = new URL(destination.href + '.tmp');
    await writeFile(temporary, JSON.stringify(cases, null, 2) + '\n');
    await rename(temporary, destination);
  }
} finally {
  await browser?.close();
  await server.close();
}
