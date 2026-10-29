import 'fake-indexeddb/auto';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server, mergeRunUpdate, client, storage;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  ({ mergeRunUpdate } = await server.ssrLoadModule(
    '/src/domain/run-updates.ts',
  ));
  client = await server.ssrLoadModule('/src/runtime/client.ts');
  storage = await server.ssrLoadModule('/src/runtime/indexed-db.ts');
});
after(async () => {
  await server?.close();
});

function mockEventSource(t, implementation) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  const mock = t.mock.fn(implementation);
  globalThis.EventSource = mock;
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'EventSource', original);
    else delete globalThis.EventSource;
  });
  return mock;
}

test('live updates ignore stale revisions and previous runs, merging nodes by identity and sequence', () => {
  const current = {
    id: 'run-a',
    revision: 4,
    nodes: [{ id: 'query', sequence: 1, status: 'running' }],
  };
  const update = {
    metadata: { id: 'run-a', revision: 5, status: 'completed' },
    nodes: [
      { id: 'result', sequence: 2 },
      { id: 'query', sequence: 1, status: 'succeeded' },
    ],
  };
  assert.equal(mergeRunUpdate(null, 'run-a', update), null);
  assert.equal(mergeRunUpdate(current, 'run-b', update), current);
  for (const revision of [3, 4]) {
    assert.equal(
      mergeRunUpdate(current, 'run-a', {
        ...update,
        metadata: { ...update.metadata, revision },
      }),
      current,
    );
  }
  const next = mergeRunUpdate(current, 'run-a', update);
  assert.equal(next.revision, 5);
  assert.equal(next.status, 'completed');
  assert.deepEqual(
    next.nodes.map((node) => node.id),
    ['query', 'result'],
  );
  assert.equal(next.nodes[0].status, 'succeeded');
  assert.equal(current.nodes[0].status, 'running');
  assert.equal(current.nodes.length, 1);
});

test('browser runtime reads its session and validates requests without fetch or EventSource', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected network request');
  });
  const events = mockEventSource(t, () => {
    throw new Error('Unexpected event stream');
  });
  assert.equal((await client.api('/session')).configured, false);
  const stop = client.subscribeRun('run-a', {
    onConnection() {},
    onSnapshot() {},
    onUpdate() {},
  });
  stop();
  await assert.rejects(client.post('/runs', {}), /无效的请求 ID/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(events.mock.callCount(), 0);
});

test('refresh settles orphaned chart jobs without losing a completed analysis', async (t) => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name, _options, callback) => callback({}),
    },
  });
  t.after(() => {
    delete navigator.locks;
  });
  await storage.writeLocal('runs', 'completed-chart', {
    id: 'completed-chart',
    status: 'completed',
    revision: 1,
    nodes: [
      {
        id: 'result',
        kind: 'result',
        visualization: { status: 'pending' },
        payload: { data: [{ total: 10 }] },
      },
    ],
    result: { data: [{ total: 10 }] },
  });
  await client.api('/session');
  const saved = await storage.readLocal('runs', 'completed-chart');
  assert.equal(saved.status, 'completed');
  assert.equal(saved.nodes[0].visualization.status, 'interrupted');
  assert.deepEqual(saved.result.data, [{ total: 10 }]);
  await storage.deleteLocal('runs', saved.id);
});

test('recovery re-reads under the task lock instead of overwriting a chart that just finished', async (t) => {
  const record = {
    id: 'chart-race',
    status: 'completed',
    revision: 1,
    nodes: [
      { id: 'result', kind: 'result', visualization: { status: 'pending' } },
    ],
  };
  await storage.writeLocal('runs', record.id, record);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name, _options, callback) => {
        await storage.writeLocal('runs', record.id, {
          ...record,
          revision: 2,
          nodes: [
            {
              id: 'result',
              kind: 'result',
              visualization: {
                status: 'ready',
                config: { type: 'column', data: [] },
              },
            },
          ],
        });
        await callback({});
      },
    },
  });
  t.after(() => {
    delete navigator.locks;
  });
  await client.api('/session');
  const saved = await storage.readLocal('runs', record.id);
  assert.equal(saved.revision, 2);
  assert.equal(saved.nodes[0].visualization.status, 'ready');
  await storage.deleteLocal('runs', record.id);
});
