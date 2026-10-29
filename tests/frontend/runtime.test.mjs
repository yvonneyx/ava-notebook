import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server, staticServer, mergeRunUpdate, remote, client;
before(async () => {
  const options = () => ({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  server = await createServer(options());
  staticServer = await createServer({ ...options(), mode: 'static' });
  ({ mergeRunUpdate } = await server.ssrLoadModule(
    '/src/domain/run-updates.ts',
  ));
  remote = await server.ssrLoadModule('/src/runtime/remote.ts');
  client = await staticServer.ssrLoadModule('/src/runtime/client.ts');
});
after(async () => {
  await server?.close();
  await staticServer?.close();
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

test('remote subscriptions forward connection, snapshot and update events and close on cleanup', (t) => {
  let stream;
  mockEventSource(
    t,
    class {
      constructor(url) {
        this.url = url;
        this.listeners = new Map();
        stream = this;
      }
      addEventListener(name, listener) {
        this.listeners.set(name, listener);
      }
      close() {
        this.closed = true;
      }
    },
  );
  const connections = [],
    snapshots = [],
    updates = [];
  const cleanup = remote.subscribeRemoteRun('run-a', {
    onConnection: (value) => connections.push(value),
    onSnapshot: (value) => snapshots.push(value),
    onUpdate: (value) => updates.push(value),
  });
  assert.equal(stream.url, '/api/runs/run-a/events');
  stream.onopen();
  stream.onerror();
  stream.listeners.get('snapshot')({ data: '{"id":"run-a","revision":4}' });
  stream.listeners.get('update')({
    data: '{"metadata":{"revision":5},"nodes":[]}',
  });
  assert.deepEqual(connections, [true, false]);
  assert.deepEqual(snapshots, [{ id: 'run-a', revision: 4 }]);
  assert.deepEqual(updates, [{ metadata: { revision: 5 }, nodes: [] }]);
  cleanup();
  assert.equal(stream.closed, true);
});

test('static runtime reads its session and rejects execution without fetch or EventSource', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected network request');
  });
  const events = mockEventSource(t, () => {
    throw new Error('Unexpected event stream');
  });
  assert.equal(client.browserMode, true);
  assert.equal((await client.api('/session')).configured, false);
  assert.equal(client.subscribeRun('run-a', {}), undefined);
  await assert.rejects(client.post('/runs', {}), /查询引擎尚未接入/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(events.mock.callCount(), 0);
});
