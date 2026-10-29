import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await delay(70);
  }
  throw new Error('Timed out waiting for expected state');
}
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
const close = (server) => new Promise((resolve) => server.close(resolve));

test(
  'CSV → real AVA direct and loop → events → retries → export → stop and restart',
  { timeout: 90000 },
  async () => {
    const prompts = [];
    const held = [];
    const model = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const prompt = body.messages.map((m) => m.content).join('\n');
      prompts.push(prompt);
      if (prompt.includes('credential-error-check')) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: { message: 'Invalid key notebook-test-key' },
          }),
        );
        return;
      }
      const summary = prompt.includes(
        'Query result (including schema and truncation details):',
      );
      const loop = prompt.includes('# 1. RESPONSE PROTOCOL');
      const iteration = (prompt.match(/Assistant:\n/g) || []).length;
      const text = loop
        ? prompt.includes('loop-invalid')
          ? 'Invalid action'
          : prompt.includes('# FINAL ATTEMPT')
          ? '[SQL]\n```sql\nSELECT SUM(sales) AS total FROM data\n```'
          : prompt.includes('loop-fallback')
          ? '[REFINE] Check the sales column.'
          : [
              '[EXPLORE]\n```sql\nSELECT missing_column FROM data\n```\n```sql\nSELECT sales FROM data LIMIT 2\n```',
              '[REFINE] Use the sales column to calculate the total.',
              '[SQL]\n```sql\nSELECT SUM(sales) AS total FROM data\n```',
              '[CONFIRM] Sales total is 10; checked against the two source rows.',
            ][Math.min(iteration, 3)]
        : summary
        ? prompt.includes('empty summary')
          ? ''
          : prompt.includes('malformed summary')
          ? 'invalid JSON notebook-test-key'
          : prompt.includes('invalid summary')
          ? '{"conclusion":""}'
          : prompt.includes('repairable summary')
          ? '```json\n{queryExplanation: "Sum sales across all rows.", conclusion: "Sales total is 10.",}\n```'
          : JSON.stringify({
              queryExplanation: 'Sum sales across all rows without filters.',
              limitations: 'Only this CSV is included.',
              conclusion: 'Sales total is 10.',
              nextStep: 'Compare sales by region.',
            })
        : prompt.includes('bad-query') ||
          (prompt.includes('retry-query') && !prompt.includes('Previous DSL:'))
        ? 'SELECT missing_column FROM data'
        : 'SELECT SUM(sales) AS total FROM data';
      const respond = () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'test-completion',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'test-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 20,
              total_tokens: 40,
            },
          }),
        );
      };
      if (prompt.includes('Hold') && !summary) held.push(respond);
      else respond();
    });
    const providerPort = await listen(model);
    const reserving = createServer();
    const port = await listen(reserving);
    await close(reserving);
    const dir = await mkdtemp(join(tmpdir(), 'ava-notebook-test-'));
    const url = `http://127.0.0.1:${port}`;
    let app,
      output = '',
      cookie = '';
    async function launch() {
      app = spawn(process.execPath, ['server/index.mjs'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(port),
          NOTEBOOK_DATA_DIR: dir,
          OPENAI_API_KEY: 'notebook-test-key',
          OPENAI_MODEL: 'test-model',
          OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      app.stdout.on('data', (data) => {
        output += data;
      });
      app.stderr.on('data', (data) => {
        output += data;
      });
      await until(async () => {
        if (app.exitCode !== null) throw new Error(output);
        try {
          const response = await fetch(`${url}/api/session`);
          if (response.ok) {
            cookie = response.headers.get('set-cookie').split(';')[0];
            return true;
          }
        } catch {}
      });
    }
    async function request(path, body, options = {}) {
      const response = await fetch(url + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Cookie: cookie,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...options,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data));
      return data;
    }
    const waitRun = (id, status) =>
      until(async () => {
        const value = await request(`/api/runs/${id}`);
        return value.status === status && value;
      });
    const idle = () =>
      until(async () => !(await request('/api/session')).activeRunId);
    const start = async (question, strategy = 'direct') => {
      await idle();
      return request('/api/runs', { sourceId: source.id, question, strategy });
    };
    let source;
    async function stopApp() {
      if (!app || app.exitCode !== null) return;
      const exited = once(app, 'exit');
      app.kill('SIGTERM');
      const timer = setTimeout(() => app.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(timer);
    }
    try {
      await launch();
      const initial = await request('/api/runs');
      assert.equal(initial.length, 3);
      assert.equal(initial.find((run) => run.id === 'case-product-profitability').strategy, 'direct');
      assert.ok(
        initial.every((run) => run.caseStudy && run.status === 'completed'),
      );
      const forbidden = await fetch(url + '/api/runs', {
        headers: { Origin: 'https://evil.example' },
      });
      assert.equal(forbidden.status, 403);
      const unauthorized = await fetch(url + '/api/runs');
      assert.equal(unauthorized.status, 401);
      const unauthorizedDelete = await fetch(url + `/api/runs/${initial[0].id}`, {
        method: 'DELETE',
      });
      assert.equal(unauthorizedDelete.status, 401);
      await assert.rejects(
        request(`/api/runs/${initial[0].id}`, undefined, { method: 'DELETE' }),
        /经典案例不能删除/,
      );
      await assert.rejects(
        request('/api/runs/not.valid', undefined, { method: 'DELETE' }),
        /Invalid task id/,
      );
      const sourceResponse = await fetch(url + '/api/sources', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'text/csv',
          'X-Filename': 'sales.csv',
        },
        body: 'region,sales\nEast,3\nWest,7\n',
      });
      source = await sourceResponse.json();
      assert.equal(source.rows, 2);
      await assert.rejects(
        request('/api/runs', {
          sourceId: source.id,
          question: 'old mode',
          strategy: 'old',
        }),
        /direct/,
      );
      await assert.rejects(
        request('/api/runs', {
          sourceId: source.id,
          question: 'old mode',
          mode: 'query',
        }),
        /mode/,
      );
      let quick = await start('Hold sum sales');
      assert.equal(quick.strategy, 'direct');
      assert.ok(!('mode' in quick));
      await until(() => held.length);
      await assert.rejects(
        request(`/api/runs/${quick.id}/control`, { command: 'pause' }),
        /stop/,
      );
      const streamAbort = new AbortController();
      const stream = await fetch(`${url}/api/runs/${quick.id}/events`, {
        headers: { Cookie: cookie },
        signal: streamAbort.signal,
      });
      const reader = stream.body.getReader();
      assert.match(
        new TextDecoder().decode((await reader.read()).value),
        /event: snapshot/,
      );
      held.shift()();
      let updates = '';
      while (!updates.includes('event: update'))
        updates += new TextDecoder().decode((await reader.read()).value);
      streamAbort.abort();
      quick = await waitRun(quick.id, 'completed');
      assert.deepEqual(quick.result.data, [{ total: 10 }]);
      assert.equal(
        quick.result.queryExplanation,
        'Sum sales across all rows without filters.',
      );
      assert.equal(quick.result.limitations, 'Only this CSV is included.');
      assert.equal(quick.result.conclusion, 'Sales total is 10.');
      assert.equal(quick.result.nextStep, 'Compare sales by region.');
      assert.ok(!('completionReason' in quick.result));
      assert.ok(!('id' in quick.result));
      assert.deepEqual(
        quick.nodes.map((node) => node.kind),
        [
          'source',
          'context',
          'step',
          'translate',
          'query',
          'result',
          'summary',
          'conclusion',
        ],
      );
      const summary = quick.nodes.find((node) => node.kind === 'summary');
      const query = quick.nodes.find((node) => node.kind === 'query');
      assert.deepEqual(summary.parents, [`${query.id}:end`]);
      assert.equal(summary.payload.queryId, `${query.id}:end`);
      assert.equal(summary.payload.usage.totalTokens, 40);
      assert.deepEqual(quick.nodes.at(-1).parents, [summary.id]);
      assert.ok(quick.nodes.every((node) => !node.checkpoint));
      const exported = await request(`/api/runs/${quick.id}/export`);
      const events = exported.run.events.filter((event) => event.context);
      assert.deepEqual(
        events.map((event) => event.type),
        [
          'stepstart',
          'translatestart',
          'translateend',
          'querystart',
          'queryend',
          'summarizestart',
          'summarizeend',
          'stepend',
        ],
      );
      for (const event of events) {
        assert.match(event.context.eventId, /:(start|end)$/);
        assert.ok(!('operationId' in event.context));
        assert.ok(event.context.stepId);
        assert.equal(
          event.nodeId,
          event.context.eventId.replace(/:(start|end)$/, ''),
        );
        if (event.type === 'stepstart' || event.type === 'stepend') {
          assert.equal(event.nodeId, event.context.stepId);
          assert.equal(event.data.step, 0);
        } else {
          assert.ok(quick.nodes.some((node) => node.id === event.nodeId));
          assert.ok(!('step' in event.data));
        }
        assert.ok(!('id' in event) && !('parentIds' in event));
        if (event.type.endsWith('end')) {
          const start = events.find(
            (candidate) =>
              candidate.type.endsWith('start') &&
              candidate.context.eventId ===
                event.context.eventId.replace(/:end$/, ':start'),
          );
          assert.ok(start);
          assert.equal(start.context.stepId, event.context.stepId);
          assert.equal(start.nodeId, event.nodeId);
        }
      }
      assert.equal(
        new Set(events.map((event) => event.context.stepId)).size,
        1,
      );
      assert.equal(prompts.length, 2);
      assert.ok(!JSON.stringify(exported).includes('notebook-test-key'));
      assert.deepEqual(
        exported.run.events.find((event) => event.type === 'schemaend').data,
        {},
      );
      const charted = await request(`/api/runs/${quick.id}/charts`, {
        nodeId: `${query.id}:end`,
        x: 'total',
        y: 'total',
      });
      assert.equal(charted.nodes.at(-1).stepId, query.stepId);
      assert.deepEqual(charted.nodes.at(-1).parents, [`${query.id}:end`]);
      await assert.rejects(
        request(`/api/runs/${quick.id}/charts`, {
          nodeId: `${query.id}:end`,
          x: 'missing',
          y: 'total',
        }),
        /有效的结果列/,
      );

      let retry = await start('retry-query total sales');
      retry = await waitRun(retry.id, 'completed');
      const queries = retry.nodes.filter((node) => node.kind === 'query');
      assert.deepEqual(
        queries.map((node) => node.status),
        ['failed', 'succeeded'],
      );
      assert.notEqual(queries[0].id, queries[1].id);
      assert.equal(queries[0].stepId, queries[1].stepId);
      assert.deepEqual(
        retry.nodes.filter((node) => node.kind === 'translate')[1].parents,
        [queries[0].id],
      );
      assert.deepEqual(
        retry.nodes.find((node) => node.kind === 'summary').parents,
        [`${queries[1].id}:end`],
      );
      assert.ok(
        prompts.some(
          (prompt) =>
            prompt.includes('Previous DSL:') &&
            prompt.includes('missing_column'),
        ),
      );
      const retryEvents = (
        await request(`/api/runs/${retry.id}/export`)
      ).run.events.filter((event) => event.context);
      assert.equal(
        new Set(retryEvents.map((event) => event.context.eventId)).size,
        12,
      );
      await idle();
      assert.deepEqual(
        await request(`/api/runs/${retry.id}`, undefined, { method: 'DELETE' }),
        { ok: true },
      );
      assert.ok(!(await request('/api/runs')).some((run) => run.id === retry.id));
      await assert.rejects(request(`/api/runs/${retry.id}`), /未找到分析记录/);
      assert.deepEqual(
        await request(`/api/runs/${retry.id}`, undefined, { method: 'DELETE' }),
        { ok: true },
      );

      let repaired = await start('repairable summary');
      repaired = await waitRun(repaired.id, 'completed');
      assert.deepEqual(repaired.result.data, [{ total: 10 }]);
      assert.equal(repaired.result.conclusion, 'Sales total is 10.');
      assert.equal(
        repaired.nodes.find((node) => node.kind === 'summary').status,
        'succeeded',
      );

      let loop = await start('loop total sales', 'loop');
      loop = await waitRun(loop.id, 'completed');
      assert.equal(loop.strategy, 'loop');
      assert.deepEqual(loop.result.data, [{ total: 10 }]);
      assert.deepEqual(
        loop.nodes
          .filter((node) => node.kind === 'step')
          .map((node) => node.payload.action),
        ['EXPLORE', 'REFINE', 'SQL', 'CONFIRM'],
      );
      assert.equal(
        loop.nodes.filter((node) => node.kind === 'query').length,
        3,
      );
      assert.ok(!loop.nodes.some((node) => node.kind === 'summary'));
      assert.match(loop.nodes.at(-1).payload.conclusion, /Sales total is 10/);
      const loopEvents = (await request(`/api/runs/${loop.id}/export`)).run
        .events;
      const loopSteps = loopEvents.filter(
        (event) => event.type === 'stepstart',
      );
      assert.equal(loopSteps.length, 4);
      for (let i = 0; i < loopSteps.length; i++)
        assert.deepEqual(
          loopSteps[i].context.parentStepIds,
          i ? [loopSteps[i - 1].context.stepId] : [],
        );

      let fallback = await start('loop-fallback', 'loop');
      fallback = await waitRun(fallback.id, 'completed');
      assert.deepEqual(fallback.result.data, [{ total: 10 }]);
      assert.ok(fallback.nodes.some((node) => node.payload.finalAttempt));
      assert.equal(fallback.nodes.at(-1).payload.conclusion, undefined);

      const invalidLoop = await start('loop-invalid', 'loop');
      const failedLoop = await waitRun(invalidLoop.id, 'failed');
      assert.equal(
        failedLoop.nodes.find((node) => node.kind === 'step').status,
        'failed',
      );
      assert.ok(!failedLoop.nodes.some((node) => node.kind === 'conclusion'));

      const heldLoop = await start('Hold loop', 'loop');
      await until(() => held.length);
      const pendingLoop = await request(`/api/runs/${heldLoop.id}`);
      assert.equal(
        pendingLoop.nodes.find((node) => node.kind === 'step').status,
        'running',
      );
      await request(`/api/runs/${heldLoop.id}/control`, { command: 'stop' });
      assert.ok(
        (await request(`/api/runs/${heldLoop.id}`)).nodes.every(
          (node) => node.status !== 'running',
        ),
      );
      held.shift()();

      for (const question of [
        'invalid summary',
        'malformed summary',
        'empty summary',
        'bad-query',
        'credential-error-check',
      ]) {
        const created = await start(question);
        const failed = await waitRun(created.id, 'failed');
        assert.ok(!failed.nodes.some((node) => node.kind === 'conclusion'));
        if (
          question === 'invalid summary' ||
          question === 'malformed summary' ||
          question === 'empty summary'
        ) {
          assert.deepEqual(
            failed.nodes.find((node) => node.kind === 'result').payload.data,
            [{ total: 10 }],
          );
          assert.equal(
            failed.nodes.find((node) => node.kind === 'summary').status,
            'failed',
          );
          assert.match(failed.error, /模型总结未符合所需格式/);
          const failure = failed.nodes.find((node) => node.kind === 'summary')
            .payload.error;
          assert.equal(failure.name, 'AI_NoObjectGeneratedError');
          assert.equal(failure.finishReason, 'stop');
          if (question === 'malformed summary') {
            assert.equal(failure.responseText, '"invalid JSON [redacted]"');
            assert.match(failure.message, /did not match schema/);
          } else if (question === 'empty summary') {
            assert.equal(failure.responseText, '');
            assert.match(failure.message, /could not parse the response/);
          } else assert.match(failure.message, /did not match schema/);
          assert.ok(
            !JSON.stringify(
              await request(`/api/runs/${created.id}/export`),
            ).includes('notebook-test-key'),
          );
        } else if (question === 'bad-query') {
          assert.equal(
            failed.nodes.filter((node) => node.kind === 'query').length,
            3,
          );
          assert.ok(!failed.nodes.some((node) => node.kind === 'result'));
        } else {
          assert.match(failed.error, /redacted/);
          assert.ok(
            !JSON.stringify(
              await request(`/api/runs/${created.id}/export`),
            ).includes('notebook-test-key'),
          );
        }
      }
      const stopping = await start('Hold stop test');
      await until(() => held.length);
      const stop = {
        command: 'stop',
        requestId: 'e6cb4f5f-a381-4fae-9815-34a09912ef60',
      };
      const stopped = await request(`/api/runs/${stopping.id}/control`, stop);
      assert.equal(stopped.status, 'cancelled');
      assert.equal(
        stopped.nodes.find((node) => node.id === stopped.activeNodeId).status,
        'cancelled',
      );
      assert.deepEqual(
        await request(`/api/runs/${stopping.id}/control`, stop),
        stopped,
      );
      held.shift()();
      await idle();
      assert.equal(
        (await request(`/api/runs/${stopping.id}`)).status,
        'cancelled',
      );

      const deleting = await start('Hold delete test');
      await until(() => held.length);
      await request(`/api/runs/${deleting.id}`, undefined, { method: 'DELETE' });
      held.shift()();
      await idle();
      await assert.rejects(request(`/api/runs/${deleting.id}`), /未找到分析记录/);

      const interrupted = await start('Hold restart test');
      await until(() => held.length);
      const exited = once(app, 'exit');
      app.kill('SIGKILL');
      await exited;
      held.shift()();
      await launch();
      assert.ok(
        !(await request('/api/runs')).some((run) =>
          [retry.id, deleting.id].includes(run.id),
        ),
      );
      const recovered = await request(`/api/runs/${interrupted.id}`);
      assert.equal(recovered.status, 'interrupted');
      assert.ok(recovered.nodes.every((node) => node.status !== 'running'));
      assert.deepEqual(
        (await request(`/api/runs/${quick.id}`)).result,
        quick.result,
      );
      const restoredLoop = await request(`/api/runs/${loop.id}`);
      assert.equal(restoredLoop.strategy, 'loop');
      assert.deepEqual(restoredLoop.nodes, loop.nodes);
      assert.equal((await request('/api/session')).activeRunId, undefined);
      const newRun = await start('sum sales after restart');
      assert.equal(
        (await waitRun(newRun.id, 'completed')).result.conclusion,
        'Sales total is 10.',
      );
      await idle();
      const example = await request('/api/examples/sales', {});
      assert.equal(example.source.rows, 1416);
      const semanticRun = await request('/api/runs', {
        sourceId: example.source.id,
        question: 'Hold semantic inspection',
      });
      await until(() => held.length);
      const semanticEvidence = await request(`/api/runs/${semanticRun.id}`);
      assert.deepEqual(
        semanticEvidence.nodes.find((node) => node.id === 'context').payload
          .semantic,
        example.source.semantic.definition,
      );
      assert.ok(prompts.at(-1).includes('广告后经营贡献'));
      await request(`/api/runs/${semanticRun.id}/control`, { command: 'stop' });
      held.shift()();
    } finally {
      await stopApp();
      model.closeAllConnections();
      await close(model);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
