import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
const { AVA } = createRequire(import.meta.url)('@antv/ava');

test('sales fixture obeys AVA semantics, complete daily grain and independent accounting totals', async () => {
  const semantic = parse(await readFile('sales-semantic.yaml', 'utf8'));
  const expected = JSON.parse(
    await readFile('tests/fixtures/sales-expected.json', 'utf8'),
  );
  const ava = new AVA({ engine: { type: 'duckdb' } });
  try {
    await ava.source({
      type: 'csv-file',
      options: { path: resolve('sales-case.csv') },
    });
    await ava.semantic(undefined, () => semantic);
    assert.deepEqual((await ava.semantic()).models[0].primaryKey, [
      'date',
      'sku',
      'region',
      'channel',
    ]);
    const quality =
      await ava.query(`SELECT COUNT(*) AS rows, COUNT(DISTINCT (date,sku,region,channel)) AS keys,
      COUNT(DISTINCT date) AS days, COUNT(*) FILTER(WHERE refund_amount IS NULL) AS missing_refunds,
      COUNT(*) FILTER(WHERE sessions=0 AND orders=0) AS zero_days,
      MAX(ABS(gross_sales-units*list_price)) AS gross_error,
      COUNT(*) FILTER(WHERE returned_units>units OR stockout_hours NOT BETWEEN 0 AND 24) AS invalid FROM data`);
    assert.ok(!quality.truncated);
    assert.equal(quality.data[0].rows, 1416);
    assert.equal(quality.data[0].keys, 1416);
    assert.equal(quality.data[0].days, 59);
    assert.ok(quality.data[0].missing_refunds > 0);
    assert.ok(quality.data[0].zero_days > 0);
    assert.equal(quality.data[0].gross_error, 0);
    assert.equal(quality.data[0].invalid, 0);
    const measures = semantic.cubes[0].measures;
    const revenue = measures.find((m) => m.name === 'net_revenue').expression;
    const contribution = measures.find(
      (m) => m.name === 'contribution_after_ads',
    ).expression;
    const totals =
      await ava.query(`SELECT strftime(date,'%Y-%m') AS month, COUNT(*) AS rows,
      COUNT(DISTINCT date) AS days, ${revenue} AS net_revenue, ${contribution} AS contribution_after_ads
      FROM data GROUP BY 1 ORDER BY 1`);
    for (const row of totals.data) {
      const known = expected[row.month];
      assert.equal(row.rows, known.rows);
      assert.equal(row.days, known.days);
      assert.ok(Math.abs(row.net_revenue - known.net_revenue) < 0.001);
      assert.ok(
        Math.abs(row.contribution_after_ads - known.contribution_after_ads) <
          0.001,
      );
    }
    const segments = await ava.query(`SELECT sku, region, channel,
      SUM(CASE WHEN month(date)=2 THEN (gross_sales-discount_amount-COALESCE(refund_amount,0)-cogs-fulfillment_cost-platform_fee-ad_spend)/28
        ELSE -(gross_sales-discount_amount-COALESCE(refund_amount,0)-cogs-fulfillment_cost-platform_fee-ad_spend)/31 END) AS daily_change
      FROM data GROUP BY ALL ORDER BY daily_change`);
    assert.equal(segments.data.length, 24);
    assert.deepEqual(
      [segments.data[0].sku, segments.data[0].region, segments.data[0].channel],
      ['COF-01', '华东', '平台店'],
    );
    const summed = segments.data.reduce(
      (total, row) => total + row.daily_change,
      0,
    );
    const overall =
      expected['2025-02'].contribution_after_ads / 28 -
      expected['2025-01'].contribution_after_ads / 31;
    assert.ok(Math.abs(summed - overall) < 0.001);
    assert.ok(segments.data.some((row) => row.daily_change > 0));
  } finally {
    await ava.dispose();
  }
});

test('sales example snapshots semantic definitions and detects snapshot tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ava-semantic-test-'));
  process.env.NOTEBOOK_DATA_DIR = dir;
  const { loadSalesExample } = await import('../server/sales-example.mjs');
  const { readSource } = await import('../server/store.mjs');
  try {
    const { source, question } = await loadSalesExample();
    assert.equal(source.rows, 1416);
    assert.equal(source.semantic.name, 'sales-semantic.yaml');
    assert.match(question, /日均/);
    assert.deepEqual(
      (await readSource(source.id)).source.semantic,
      source.semantic,
    );
    const path = join(dir, 'sources', source.id, 'source.json');
    const changed = JSON.parse(await readFile(path, 'utf8'));
    changed.semantic.definition.description = 'changed';
    await writeFile(path, JSON.stringify(changed));
    await assert.rejects(readSource(source.id), /语义快照已变化/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
