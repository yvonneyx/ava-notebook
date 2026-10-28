import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCSV } from '../server/store.mjs';
import { applyEvent, forkPrefix } from '../server/evidence.mjs';

test('CSV validation rejects malformed, duplicate-header and non-CSV inputs', () => {
  assert.throws(() => inspectCSV(Buffer.from('a,b\n1,2'), 'x.json'));
  assert.throws(() => inspectCSV(Buffer.from('a,a\n1,2'), 'x.csv'));
  assert.throws(() => inspectCSV(Buffer.from('a,b\n1,2,3'), 'x.csv'));
  assert.throws(() => inspectCSV(Buffer.from('a,b\n'), 'x.csv'));
  assert.deepEqual(
    inspectCSV(Buffer.from('\ufeffa,b\n"x,y",2\n'), 'x.csv').preview,
    [{ a: 'x,y', b: '2' }],
  );
});

test('telemetry alone builds nodes, real SQL results and explicit provenance', () => {
  const run = { nodes: [{ id: 'context', sequence: 0, kind: 'context' }] };
  const emit = (type, data) => applyEvent(run, { type, data });
  emit('loopstep', { stepId: 'm-0', phase: 'model', step: 0 });
  emit('reasonend', { step: 0, action: 'SQL', text: '[SQL] select 2' });
  emit('loopstep', {
    stepId: 'q-0-0',
    phase: 'query',
    step: 0,
    queryIndex: 0,
    action: 'SQL',
    dsl: 'SELECT 1',
  });
  emit('querystart', { dsl: 'SELECT 2' });
  emit('queryend', {
    schema: [{ name: 'value' }],
    data: [{ value: 2 }],
    rowCount: 1,
  });
  assert.equal(run.nodes.find((n) => n.id === 'q-0-0').payload.sql, 'SELECT 2');
  const result = run.nodes.find((n) => n.kind === 'result');
  assert.deepEqual(result.parents, ['q-0-0']);
  assert.deepEqual(result.payload.data, [{ value: 2 }]);
  run.nodes.find((n) => n.id === 'q-0-0').checkpoint = 'q-0-0';
  const prefix = forkPrefix(run, 'q-0-0');
  assert.deepEqual(
    prefix.map((n) => n.id),
    ['context', 'm-0'],
  );
  assert.ok(prefix.every((n) => n.inherited));
});
