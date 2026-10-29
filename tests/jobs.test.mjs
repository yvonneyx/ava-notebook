import test from 'node:test';
import assert from 'node:assert/strict';
import { Jobs } from '../server/jobs.mjs';

test('a step can wait beyond 120 seconds and still be stopped manually', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const jobs = new Jobs('test-build');
  const node = { id: 'm-0', status: 'paused', payload: {} };
  const run = {
    id: 'long-running-step',
    status: 'paused',
    activeNodeId: node.id,
    nodes: [node],
  };
  const child = {
    send: t.mock.fn(),
    kill: t.mock.fn(),
    exitCode: null,
  };
  const job = {
    run,
    child,
    gate: { requestId: 1, state: { phase: 'model' } },
  };
  jobs.active = job;
  t.mock.method(jobs, 'persist', async () => {});

  await jobs.release(job, {});
  t.mock.timers.tick(120001);
  await jobs.queue;
  assert.equal(run.status, 'running');
  assert.equal(child.kill.mock.callCount(), 0);

  await jobs.command(run.id, { command: 'stop' });
  assert.equal(run.status, 'cancelled');
  assert.equal(node.status, 'cancelled');
  assert.deepEqual(child.send.mock.calls.at(-1).arguments, [{ type: 'cancel' }]);
  t.mock.timers.tick(1500);
  assert.deepEqual(child.kill.mock.calls.at(-1).arguments, ['SIGKILL']);
});
