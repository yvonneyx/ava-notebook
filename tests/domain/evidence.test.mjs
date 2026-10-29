import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEvent,
  completeRun,
  eventNodeId,
} from '../../shared/evidence.mjs';
import { emit, directRun } from '../fixtures/direct-events.mjs';
import { loopRun } from '../fixtures/loop-events.mjs';

test('direct context IDs retain retries, SQL, exact summary source, limitations and usage', () => {
  const run = directRun();
  const node = (id) => run.nodes.find((node) => node.id === id);
  assert.equal(node('query-failed').status, 'failed');
  assert.deepEqual(node('translation-ok').parents, ['query-failed']);
  assert.deepEqual(node('query-ok').parents, ['translation-ok']);
  assert.equal(node('query-ok').title, '查询 2 · 获取数据');
  assert.deepEqual(node('query-ok:end').parents, ['query-ok']);
  assert.deepEqual(node('query-ok:end').payload.data, [{ total: 10 }]);
  assert.equal(node('query-ok:end').payload.truncatedBy, 'maxRows');
  assert.deepEqual(node('summary').parents, ['query-ok:end']);
  assert.equal(node('summary').payload.queryId, 'query-ok:end');
  assert.equal(node('summary').payload.usage.totalTokens, 40);
  assert.equal(node('translation-ok').payload.usage.totalTokens, 20);
  assert.ok(node('summary').payload.limitations);
  assert.deepEqual(node('conclusion').parents, ['summary']);
  assert.ok(run.nodes.every((node) => node.stepId === 'step-a'));
  assert.ok(
    run.nodes.every((node) => !('step' in node) && !('checkpoint' in node)),
  );
  assert.equal(run.status, 'completed');
  assert.equal(run.result.completionReason, undefined);
});

test('interleaved steps pair eventId start/end events and summaries follow queryId, not the active node', () => {
  const run = { nodes: [] };
  emit(run, 'stepstart', 'a', { step: 0 }, 'a');
  emit(run, 'translatestart', 'ta', { query: 'A' }, 'a');
  emit(run, 'translateend', 'ta', { dsl: 'SELECT 1' }, 'a');
  emit(run, 'querystart', 'qa', { dsl: 'SELECT 1' }, 'a');
  emit(run, 'stepstart', 'b', { step: 1 }, 'b');
  emit(run, 'translatestart', 'tb', { query: 'B' }, 'b');
  emit(run, 'translateend', 'tb', { dsl: 'SELECT 2' }, 'b');
  emit(run, 'querystart', 'qb', { dsl: 'SELECT 2' }, 'b');
  emit(run, 'queryend', 'qa', { data: [{ value: 1 }] }, 'a');
  assert.equal(run.activeNodeId, 'qb');
  assert.equal(run.nodes.find((node) => node.id === 'qb').status, 'running');
  emit(run, 'queryend', 'qb', { data: [{ value: 2 }] }, 'b');
  emit(run, 'summarizestart', 'sa', { queryId: 'qa:end' }, 'a');
  assert.deepEqual(run.nodes.find((node) => node.id === 'sa').parents, [
    'qa:end',
  ]);
  emit(run, 'stepstart', 'c', { step: 2 }, 'c', ['a', 'b']);
  assert.deepEqual(run.nodes.at(-1).parentStepIds, ['a', 'b']);
  assert.deepEqual(run.nodes.at(-1).parents, ['sa', 'qb:end']);
});

test('failed summaries preserve executed evidence without a completed conclusion', () => {
  const run = directRun({ summaryError: true });
  assert.equal(
    run.nodes.find((node) => node.kind === 'summary').status,
    'failed',
  );
  assert.deepEqual(
    run.nodes.find((node) => node.kind === 'result').payload.data,
    [{ total: 10 }],
  );
  assert.ok(!run.nodes.some((node) => node.kind === 'conclusion'));
  assert.throws(() => completeRun(run, {}), /缺少成功结束的步骤事件/);
});

test('loop steps retain multiple queries, corrections and confirmation through event edges', () => {
  const run = loopRun();
  const node = (id) => run.nodes.find((node) => node.id === id);
  assert.deepEqual(node('bad').parents, ['explore']);
  assert.deepEqual(node('sample').parents, ['explore']);
  assert.deepEqual(node('refine').parentStepIds, ['explore']);
  assert.deepEqual(node('refine').parents, ['bad', 'sample:end']);
  assert.deepEqual(node('answer').parents, ['refine']);
  assert.deepEqual(node('confirm').parents, ['total:end']);
  assert.deepEqual(node('conclusion').parents, ['confirm']);
  assert.equal(
    node('conclusion').payload.conclusion,
    '已检查两行数据，销售总额为 10。',
  );
  assert.equal(node('explore').status, 'succeeded');
  assert.equal(node('bad').status, 'failed');
  assert.equal(run.nodes.filter((node) => node.kind === 'step').length, 4);
  assert.ok(!run.nodes.some((node) => node.kind === 'summary'));
});

test('loop final query is not presented as a confirmed conclusion, and failed steps cannot complete', () => {
  const run = loopRun({ confirmed: false });
  const final = run.nodes.at(-1);
  assert.equal(run.status, 'completed');
  assert.deepEqual(final.parents, ['total:end']);
  assert.equal(final.payload.conclusion, undefined);
  assert.equal(
    run.nodes.find((node) => node.id === 'answer').payload.finalAttempt,
    true,
  );
  const failed = loopRun({ failed: true });
  assert.throws(() => completeRun(failed, {}), /步骤事件/);
  assert.ok(!failed.nodes.some((node) => node.kind === 'conclusion'));
});

test('old top-level IDs and numeric steps are not projected', () => {
  const run = { nodes: [] };
  assert.deepEqual(
    applyEvent(run, {
      type: 'translatestart',
      id: 'old',
      parentIds: [],
      data: { step: 0, query: 'old' },
    }),
    [],
  );
  assert.deepEqual(run.nodes, []);
});

test('only matching eventId start/end suffixes identify operation nodes', () => {
  for (const [type, context] of [
    ['querystart', { operationId: 'old-operation', stepId: 'a' }],
    ['querystart', { eventId: 'query', stepId: 'a' }],
    ['querystart', { eventId: 'query:end', stepId: 'a' }],
    ['queryend', { eventId: 'query:start', stepId: 'a' }],
  ]) {
    const event = { type, context, data: { dsl: 'SELECT 1' } };
    assert.equal(eventNodeId(event), undefined);
    assert.deepEqual(applyEvent({ nodes: [] }, event), []);
  }
  for (const phase of ['start', 'end'])
    assert.equal(
      eventNodeId({
        type: `query${phase}`,
        context: { eventId: `query:${phase}` },
      }),
      'query',
    );
});
