import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { applyEvent, completeRun } from '../../shared/evidence.mjs';

test('classic cases replay new AVA events and preserve evidence', async () => {
  const cases = JSON.parse(
    await readFile(
      new URL('../../examples/classic/generated/cases.json', import.meta.url),
      'utf8',
    ),
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
    const results = saved.nodes.filter(
      (node) => node.kind === 'result' && node.payload.data?.length,
    );
    assert.ok(results.some((node) => node.visualization?.status === 'ready'));
    for (const result of results) {
      assert.ok(['ready', 'empty'].includes(result.visualization?.status));
      if (result.visualization.status === 'ready') {
        assert.equal(
          result.visualization.config.type,
          result.visualization.chartType,
        );
        assert.ok(!('html' in result.visualization));
      }
    }
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
    const response = { ...saved.result };
    // These fields are projected from summary events, rather than returned by analyze().
    for (const field of [
      'queryExplanation',
      'limitations',
      'conclusion',
      'nextStep',
    ])
      delete response[field];
    completeRun(replay, response);
    const summary = saved.nodes.find((node) => node.kind === 'summary');
    for (const field of [
      'queryExplanation',
      'limitations',
      'conclusion',
      'nextStep',
    ])
      if (summary?.payload[field] !== undefined)
        assert.equal(saved.result[field], summary.payload[field]);
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
});

test('quick profitability case uses one query and reconciles every product to the CSV', async () => {
  const cases = JSON.parse(
    await readFile(
      new URL('../../examples/classic/generated/cases.json', import.meta.url),
      'utf8',
    ),
  );
  const run = cases.find((item) => item.id === 'case-product-profitability');
  assert.equal(run.strategy, 'direct');
  for (const kind of [
    'step',
    'translate',
    'query',
    'result',
    'summary',
    'conclusion',
  ]) {
    const nodes = run.nodes.filter((node) => node.kind === kind);
    assert.equal(nodes.length, 1, kind);
    assert.equal(nodes[0].status, 'succeeded', kind);
  }
  const csv = parse(
    await readFile(
      new URL(
        '../../examples/classic/datasets/regional-sales.csv',
        import.meta.url,
      ),
      'utf8',
    ),
    { columns: true, skip_empty_lines: true },
  );
  const products = new Map();
  for (const row of csv) {
    const totals = products.get(row.product) || { sales: 0, profit: 0 };
    totals.sales += Math.round(Number(row.sales) * 100);
    totals.profit += Math.round(Number(row.profit) * 100);
    products.set(row.product, totals);
  }
  const totalProfit = [...products.values()].reduce(
    (sum, item) => sum + item.profit,
    0,
  );
  const expected = [...products]
    .sort((a, b) => b[1].profit - a[1].profit)
    .map(([product, totals]) => ({
      商品: product,
      销售额: totals.sales / 100,
      利润: totals.profit / 100,
      '利润率（%）': Number(((100 * totals.profit) / totals.sales).toFixed(2)),
      '利润占比（%）': Number(((100 * totals.profit) / totalProfit).toFixed(2)),
    }));
  const actual = run.result.data.map((row) => ({
    商品: row.product,
    销售额: Number(row.total_sales.toFixed(2)),
    利润: Number(row.total_profit.toFixed(2)),
    '利润率（%）': Number((100 * row.profit_margin).toFixed(2)),
    '利润占比（%）': Number((100 * row.profit_proportion).toFixed(2)),
  }));
  assert.deepEqual(actual, expected);
  assert.match(run.result.conclusion, /Laptop/);
  assert.match(run.result.conclusion, /19\.13/);
  assert.match(run.result.conclusion, /26\.35/);
  assert.ok(run.result.queryExplanation);
  assert.ok(run.result.limitations);
  assert.ok(run.result.nextStep);
});

test('refreshed sales case reconciles month totals and daily values to independent accounting', async () => {
  const cases = JSON.parse(
    await readFile(
      new URL('../../examples/classic/generated/cases.json', import.meta.url),
      'utf8',
    ),
  );
  const expected = JSON.parse(
    await readFile(
      new URL('../fixtures/sales-expected.json', import.meta.url),
      'utf8',
    ),
  );
  const run = cases.find((item) => item.id === 'case-sales-performance');
  assert.equal(run.result.data.length, 2);
  for (const row of run.result.data) {
    const month = new Date(row.month).toISOString().slice(0, 7);
    const known = expected[month];
    assert.ok(known);
    assert.equal(row.days, known.days);
    assert.ok(Math.abs(row.net_revenue - known.net_revenue) < 0.001);
    assert.ok(
      Math.abs(row.contrib_after_ads - known.contribution_after_ads) < 0.001,
    );
    assert.equal(
      row.daily_net_revenue,
      Number((known.net_revenue / known.days).toFixed(2)),
    );
    assert.equal(
      row.daily_contrib_after_ads,
      Number((known.contribution_after_ads / known.days).toFixed(2)),
    );
  }
});
