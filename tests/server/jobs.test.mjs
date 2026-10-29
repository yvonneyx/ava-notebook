import test from 'node:test';
import assert from 'node:assert/strict';
import { Jobs } from '../../server/analysis/jobs.mjs';

test('direct can wait beyond 120 seconds and stopping ignores late events', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const jobs = new Jobs('test-build');
  const node = { id: 'translation', status: 'running', payload: {} };
  const step = { id: 'step', status: 'running', payload: {} };
  const run = {
    id: 'long-running-step',
    status: 'running',
    activeNodeId: node.id,
    nodes: [step, node],
    commandIds: [],
  };
  const child = { kill: t.mock.fn() };
  const job = { run, child };
  jobs.active = job;
  t.mock.method(jobs, 'persist', async () => {});
  t.mock.timers.tick(120001);
  assert.equal(run.status, 'running');
  assert.equal(child.kill.mock.callCount(), 0);
  await jobs.command(run.id, { requestId: 'stop-once' });
  assert.equal(run.status, 'cancelled');
  assert.equal(node.status, 'cancelled');
  assert.equal(step.status, 'cancelled');
  assert.deepEqual(child.kill.mock.calls.at(-1).arguments, ['SIGKILL']);
  await jobs.command(run.id, { requestId: 'stop-once' });
  assert.equal(child.kill.mock.callCount(), 1);
  await jobs.message(job, { type: 'done', result: { conclusion: 'too late' } });
  assert.equal(run.status, 'cancelled');
  assert.equal(run.nodes.length, 2);
});
