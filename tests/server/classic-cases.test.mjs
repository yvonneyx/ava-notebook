import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { applyEvent, completeRun } from '../../server/analysis/evidence.mjs';

test('classic cases replay new AVA events and seed once without changing personal records', async () => {
  const cases = JSON.parse(
    await readFile(new URL('../../examples/classic/generated/cases.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    cases.map((run) => run.strategy),
    ['loop', 'loop', 'direct'],
  );
  for (const saved of cases) {
    assert.equal(saved.status, 'completed');
    assert.ok(saved.caseStudy.title);
    assert.equal(saved.caseStudy.recorded, true);
    assert.ok(!('mode' in saved));
    assert.ok(saved.nodes.every((node) => !node.checkpoint));
    const replay = { strategy: saved.strategy, nodes: [] };
    const ids = new Set();
    for (const event of saved.events) {
      if (!event.context) continue;
      assert.match(event.context.eventId, /:(start|end)$/);
      assert.ok(event.context.stepId);
      assert.ok(!event.context.operationId && !event.parentIds);
      assert.ok(!ids.has(event.context.eventId));
      ids.add(event.context.eventId);
      applyEvent(replay, event);
    }
    completeRun(replay, saved.result);
    assert.deepEqual(
      JSON.parse(JSON.stringify(replay.nodes.at(-1).payload)),
      saved.nodes.find((node) => node.kind === 'conclusion').payload,
    );
    assert.deepEqual(
      replay.nodes
        .filter((node) => node.kind === 'query')
        .map((node) => [node.id, node.payload.sql]),
      saved.nodes
        .filter((node) => node.kind === 'query')
        .map((node) => [node.id, node.payload.sql]),
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'ava-cases-test-'));
  process.env.NOTEBOOK_DATA_DIR = dir;
  const store = await import('../../server/storage/index.mjs');
  const { seedClassicCases } = await import('../../server/examples/seed.mjs');
  try {
    const personal = {
      id: 'personal',
      createdAt: '2026-10-29T00:00:00Z',
      nodes: [],
    };
    await store.saveRun(personal);
    await seedClassicCases();
    const all = await store.listRuns();
    assert.equal(all.length, 4);
    assert.deepEqual(await store.readRun('personal'), personal);
    for (const snapshot of cases) {
      const run = await store.readRun(snapshot.id);
      assert.equal(
        (await store.readSource(run.source.id)).source.hash,
        snapshot.source.hash,
      );
      assert.deepEqual(
        run.nodes.find((node) => node.kind === 'source').payload,
        run.source,
      );
      run.revision++;
      await store.saveRun(run);
    }
    const updated = await store.listRuns();
    await seedClassicCases();
    assert.deepEqual(await store.listRuns(), updated);
  } finally {
    await store.closeStore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('quick profitability case uses one query and reconciles every product to the CSV', async () => {
  const cases = JSON.parse(
    await readFile(new URL('../../examples/classic/generated/cases.json', import.meta.url), 'utf8'),
  );
  const run = cases.find((item) => item.id === 'case-product-profitability');
  assert.equal(run.strategy, 'direct');
  for (const kind of ['step', 'translate', 'query', 'result', 'summary', 'conclusion']) {
    const nodes = run.nodes.filter((node) => node.kind === kind);
    assert.equal(nodes.length, 1, kind);
    assert.equal(nodes[0].status, 'succeeded', kind);
  }
  const csv = parse(
    await readFile(new URL('../../examples/classic/datasets/regional-sales.csv', import.meta.url), 'utf8'),
    { columns: true, skip_empty_lines: true },
  );
  const products = new Map();
  for (const row of csv) {
    const totals = products.get(row.product) || { sales: 0, profit: 0 };
    totals.sales += Math.round(Number(row.sales) * 100);
    totals.profit += Math.round(Number(row.profit) * 100);
    products.set(row.product, totals);
  }
  const totalProfit = [...products.values()].reduce((sum, item) => sum + item.profit, 0);
  const expected = [...products].sort((a, b) => b[1].profit - a[1].profit).map(([product, totals]) => ({
    商品: product,
    销售额: totals.sales / 100,
    利润: totals.profit / 100,
    '利润率（%）': Number((100 * totals.profit / totals.sales).toFixed(2)),
    '利润占比（%）': Number((100 * totals.profit / totalProfit).toFixed(2)),
  }));
  assert.deepEqual(run.result.data, expected);
  assert.match(run.result.conclusion, /Laptop.*115,746\.25.*22,146\.25.*26\.35%.*19\.13%/s);
  assert.match(run.result.conclusion, /Office Chair.*15,580\.30.*Monitor.*15,459\.00/s);
  assert.ok(run.result.queryExplanation);
  assert.ok(run.result.limitations);
  assert.ok(run.result.nextStep);
});
