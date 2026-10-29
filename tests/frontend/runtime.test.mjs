import 'fake-indexeddb/auto';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server, mergeRunUpdate, client;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  ({ mergeRunUpdate } = await server.ssrLoadModule(
    '/src/domain/run-updates.ts',
  ));
  client = await server.ssrLoadModule('/src/runtime/client.ts');
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
