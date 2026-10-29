import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, cp } from 'node:fs/promises';
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
  'CSV → real AVA loop → event evidence → edit → branch → crash recovery',
  { timeout: 90000 },
  async () => {
    const prompts = [];
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
      const history = prompt.split('# ITERATION HISTORY')[1] || '';
      const text = !history
        ? '[EXPLORE]\n```sql\nSELECT COUNT(*) AS count FROM data\n```\n```sql\nSELECT SUM(sales) AS total FROM data\n```'
        : history.includes('Assistant:\n[SQL]')
        ? '[CONFIRM]\nVerification: actual query returned total 10.\nConclusion: sales total is 10.'
        : '[SQL]\n```sql\nSELECT SUM(sales) AS total FROM data\n```';
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
          usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
        }),
      );
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
    const waitRun = (id, predicate) =>
      until(async () => {
        const value = await request(`/api/runs/${id}`);
        if (value.status === 'failed') throw new Error(value.error);
        return predicate(value) && value;
      });
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
      const forbidden = await fetch(url + '/api/runs', {
        headers: { Origin: 'https://evil.example' },
      });
      assert.equal(forbidden.status, 403);
      const unauthorized = await fetch(url + '/api/runs');
      assert.equal(unauthorized.status, 401);
      const sourceResponse = await fetch(url + '/api/sources', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'text/csv',
          'X-Filename': 'sales.csv',
        },
        body: 'region,sales\nEast,3\nWest,7\n',
      });
      const source = await sourceResponse.json();
      assert.equal(source.rows, 2);
      let run = await request('/api/runs', {
        sourceId: source.id,
        question: 'Sum sales',
        mode: 'query',
      });
      run = await waitRun(run.id, (r) => r.status === 'paused');
      assert.equal(run.activeNodeId, 'q-0-0');
      assert.ok(run.nodes.find((n) => n.kind === 'context').payload.schema);
      assert.ok(
        run.nodes
          .find((n) => n.kind === 'reason')
          .payload.prompt.includes('Sum sales'),
      );
      const streamAbort = new AbortController();
      const stream = await fetch(`${url}/api/runs/${run.id}/events`, {
        headers: { Cookie: cookie },
        signal: streamAbort.signal,
      });
      const reader = stream.body.getReader();
      assert.match(
        new TextDecoder().decode((await reader.read()).value),
        /event: snapshot/,
      );
      const commandId = 'e6cb4f5f-a381-4fae-9815-34a09912ef60';
      await request(`/api/runs/${run.id}/control`, {
        command: 'continue',
        requestId: commandId,
        nodeId: 'q-0-0',
        sql: "SELECT SUM(sales) AS adjusted FROM data WHERE region = 'East'",
      });
      let receivedUpdate = false;
      for (let i = 0; i < 10; i++) {
        const chunk = await reader.read();
        if (new TextDecoder().decode(chunk.value).includes('event: update')) {
          receivedUpdate = true;
          break;
        }
      }
      assert.ok(receivedUpdate);
      streamAbort.abort();
      run = await waitRun(
        run.id,
        (r) => r.status === 'paused' && r.activeNodeId === 'q-0-1',
      );
      assert.deepEqual(
        run.nodes.find((n) => n.id === 'q-0-0-result').payload.data,
        [{ adjusted: 3 }],
      );
      const duplicate = await request(`/api/runs/${run.id}/control`, {
        command: 'continue',
        requestId: commandId,
        nodeId: 'q-0-0',
      });
      assert.equal(duplicate.status, 'paused');
      assert.equal(duplicate.activeNodeId, 'q-0-1');
      await request(`/api/runs/${run.id}/control`, { command: 'stop' });
      await until(async () => !(await request('/api/session')).activeRunId);
      let branch = await request(`/api/runs/${run.id}/fork`, {
        nodeId: 'q-0-1',
        mode: 'auto',
      });
      branch = await waitRun(branch.id, (r) => r.status === 'completed');
      assert.equal(branch.parentId, run.id);
      assert.equal(branch.result.completionReason, 'confirmed');
      assert.ok(branch.nodes.find((n) => n.id === 'q-0-0-result').inherited);
      assert.equal(
        branch.nodes.filter((n) => n.id === 'q-0-0-result').length,
        1,
      );
      assert.ok(prompts.at(-1).includes("WHERE region = 'East'"));
      const evidence = await request(`/api/runs/${branch.id}/export`);
      assert.ok(!JSON.stringify(evidence).includes('notebook-test-key'));
      assert.equal(
        evidence.run.events.filter((e) => e.type === 'querystart').length,
        2,
      );
      await until(async () => !(await request('/api/session')).activeRunId);
      let editedAgain = await request(`/api/runs/${run.id}/fork`, {
        nodeId: 'q-0-0',
        mode: 'auto',
      });
      editedAgain = await waitRun(
        editedAgain.id,
        (r) => r.status === 'completed',
      );
      assert.deepEqual(
        editedAgain.nodes.find((n) => n.id === 'q-0-0-result').payload.data,
        [{ adjusted: 3 }],
      );
      await until(async () => !(await request('/api/session')).activeRunId);
      const charted = await request(`/api/runs/${branch.id}/charts`, {
        nodeId: 'q-1-0-result',
        x: 'total',
        y: 'total',
      });
      assert.equal(charted.nodes.at(-1).kind, 'chart');
      let recover = await request('/api/runs', {
        sourceId: source.id,
        question: 'Sum sales',
        mode: 'query',
      });
      recover = await waitRun(recover.id, (r) => r.status === 'paused');
      await stopApp();
      await launch();
      const interrupted = await request(`/api/runs/${recover.id}`);
      assert.equal(interrupted.status, 'interrupted');
      let resumed = await request(`/api/runs/${recover.id}/fork`, {
        nodeId: interrupted.activeNodeId,
        mode: 'auto',
      });
      resumed = await waitRun(resumed.id, (r) => r.status === 'completed');
      assert.equal(resumed.result.completionReason, 'confirmed');
      await until(async () => !(await request('/api/session')).activeRunId);
      const example = await request('/api/examples/sales', {});
      assert.equal(example.source.rows, 1416);
      let semanticRun = await request('/api/runs', {
        sourceId: example.source.id,
        question: example.question,
        mode: 'query',
      });
      semanticRun = await waitRun(semanticRun.id, (r) => r.status === 'paused');
      assert.deepEqual(
        semanticRun.nodes.find((n) => n.id === 'context').payload.semantic,
        example.source.semantic.definition,
      );
      assert.ok(prompts.at(-1).includes('广告后经营贡献'));
      assert.ok(prompts.at(-1).includes('analysisGuidance'));
      await request(`/api/runs/${semanticRun.id}/control`, { command: 'stop' });
      await until(async () => !(await request('/api/session')).activeRunId);
      let semanticBranch = await request(`/api/runs/${semanticRun.id}/fork`, {
        nodeId: 'm-0',
        mode: 'query',
      });
      semanticBranch = await waitRun(
        semanticBranch.id,
        (r) => r.status === 'paused',
      );
      assert.equal(
        semanticBranch.source.semantic.hash,
        semanticRun.source.semantic.hash,
      );
      assert.deepEqual(
        semanticBranch.nodes.find((n) => n.id === 'context').payload.semantic,
        example.source.semantic.definition,
      );
      await request(`/api/runs/${semanticBranch.id}/control`, {
        command: 'stop',
      });
      await until(async () => !(await request('/api/session')).activeRunId);
      const rejected = await request('/api/runs', {
        sourceId: source.id,
        question: 'credential-error-check',
        mode: 'auto',
      });
      const failed = await until(async () => {
        const run = await request(`/api/runs/${rejected.id}`);
        return run.status === 'failed' && run;
      });
      assert.match(failed.error, /redacted/);
      assert.ok(!JSON.stringify(failed).includes('notebook-test-key'));
      if (process.env.NOTEBOOK_TEST_ARTIFACTS)
        await cp(dir, process.env.NOTEBOOK_TEST_ARTIFACTS, { recursive: true });
    } finally {
      await stopApp();
      model.closeAllConnections();
      await close(model);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
