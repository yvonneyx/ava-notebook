import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { directRun } from '../fixtures/direct-events.mjs';
import { loopRun } from '../fixtures/loop-events.mjs';

let server, layoutGraph;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  ({ layoutGraph } = await server.ssrLoadModule('/src/features/graph/layout.ts'));
});
after(async () => { await server?.close(); });

function checkLayout(evidence) {
  const snapshot = structuredClone(evidence);
  const layout = layoutGraph(evidence);
  assert.deepEqual(evidence, snapshot);
  assert.deepEqual(
    layout.nodes.map((node) => node.id).sort(),
    evidence.map((node) => node.id).sort(),
  );
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId);
    assert.ok(layout.nodes.indexOf(parent) < layout.nodes.indexOf(node));
    assert.ok(node.position.x >= 0 && node.position.y >= 92);
    assert.ok(node.position.x + node.width <= parent.width);
    assert.ok(node.position.y + node.height <= parent.height);
  }
  for (let i = 0; i < layout.nodes.length; i++) {
    for (const b of layout.nodes.slice(i + 1)) {
      const a = layout.nodes[i];
      if (a.parentId !== b.parentId) continue;
      assert.ok(
        a.position.x + a.width <= b.position.x ||
        b.position.x + b.width <= a.position.x ||
        a.position.y + a.height <= b.position.y ||
        b.position.y + b.height <= a.position.y,
        `${a.id} overlaps ${b.id}`,
      );
    }
  }
  const validEdges = evidence.flatMap((node) =>
    [...new Set(node.parents)]
      .filter((id) => byId.has(id) && id !== node.id)
      .map((id) => JSON.stringify([id, node.id])),
  );
  assert.deepEqual(layout.edges.map((edge) => edge.id).sort(), validEdges.sort());
  return { ...layout, byId };
}

test('step subgraphs contain retries, results, summaries and conclusions without losing event edges', () => {
  const { nodes } = directRun();
  const layout = checkLayout(nodes);
  assert.equal(layout.byId.get('step-a').childCount, nodes.length - 1);
  assert.ok(layout.nodes.filter((node) => node.id !== 'step-a')
    .every((node) => node.parentId === 'step-a'));
  assert.equal(layout.edges.find((edge) => edge.source === 'step-a').sourceHandle, 'events');
});

test('loop subgraphs retain branches, empty steps and exact cross-step output references', () => {
  for (const options of [{}, { running: true }, { failed: true }]) {
    const layout = checkLayout(loopRun(options).nodes);
    assert.equal(layout.byId.get('explore').childCount, 3);
    assert.equal(layout.byId.get('refine').childCount, 0);
    assert.equal(layout.byId.get('sample:end').parentId, 'explore');
    assert.equal(layout.byId.get('answer').stepNumber, 3);
    assert.ok(layout.edges.some((edge) => edge.source === 'sample:end' && edge.target === 'refine'));
    assert.ok(layout.edges.some((edge) => edge.source === 'bad' && edge.target === 'refine'));
    assert.equal(layout.edges.find((edge) => edge.source === 'refine').sourceHandle, 'output');
  }
});

test('interleaved steps, charts and ungrouped evidence stay visible; invalid edges are ignored', () => {
  const make = (id, kind, stepId, parents = []) => ({
    id, kind, stepId, parents, sequence: 0, title: id, status: 'succeeded', payload: {},
  });
  const nodes = [
    make('source', 'source'),
    make('context', 'context', undefined, ['source']),
    make('a', 'step', 'step-a', ['context']),
    make('qa', 'query', 'step-a', ['a']),
    make('b', 'step', 'step-b', ['context']),
    make('qb', 'query', 'step-b', ['b']),
    make('ra', 'result', 'step-a', ['qa']),
    make('rb', 'result', 'step-b', ['qb']),
    make('c', 'step', 'step-c', ['a', 'ra', 'rb', 'rb']),
    make('chart', 'chart', 'step-a', ['ra']),
    make('orphan', 'query', 'unknown', ['missing', 'orphan']),
  ].map((node, sequence) => ({ ...node, sequence }));
  const layout = checkLayout([...nodes].reverse());
  assert.equal(layout.byId.get('chart').parentId, 'a');
  assert.equal(layout.byId.get('orphan').parentId, undefined);
  assert.equal(layout.byId.get('context').parentId, undefined);
  assert.equal(layout.byId.get('c').stepNumber, 3);
  assert.equal(layout.edges.find((edge) => edge.source === 'a' && edge.target === 'c').sourceHandle, 'output');
  assert.deepEqual(layoutGraph([]), { nodes: [], edges: [] });
  assert.equal(checkLayout(loopRun({ running: true }).nodes.slice(0, 1)).nodes[0].childCount, 0);
});
