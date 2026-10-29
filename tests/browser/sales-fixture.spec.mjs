import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

test('Wasm sales fixture preserves semantics, daily grain and independent accounting totals', async ({
  page,
}) => {
  const csv = await readFile('examples/sales/sales-case.csv', 'utf8');
  const semantic = parse(
    await readFile('examples/sales/sales-semantic.yaml', 'utf8'),
  );
  const expected = JSON.parse(
    await readFile('tests/fixtures/sales-expected.json', 'utf8'),
  );
  await page.goto('http://127.0.0.1:5174/tests/browser/engine.html');
  await page.waitForFunction(() => !!window.AVA);
  const { key, quality, totals, segments } = await page.evaluate(
    async ({ csv, semantic }) => {
      const ava = new window.AVA({
        llm: { model: 'test' },
        engine: { type: 'duckdb-wasm', bundles: window.bundles },
      });
      try {
        await ava.source({ type: 'csv', options: { csv } });
        await ava.semantic(undefined, () => semantic);
        const key = (await ava.semantic()).models[0].primaryKey;
        const quality =
          await ava.query(`SELECT COUNT(*) AS rows, COUNT(DISTINCT (date,sku,region,channel)) AS keys,
        COUNT(DISTINCT date) AS days, COUNT(*) FILTER(WHERE refund_amount IS NULL) AS missing_refunds,
        COUNT(*) FILTER(WHERE sessions=0 AND orders=0) AS zero_days,
        MAX(ABS(gross_sales-units*list_price)) AS gross_error,
        COUNT(*) FILTER(WHERE returned_units>units OR stockout_hours NOT BETWEEN 0 AND 24) AS invalid FROM data`);
        const measures = semantic.cubes[0].measures;
        const revenue = measures.find(
          (m) => m.name === 'net_revenue',
        ).expression;
        const contribution = measures.find(
          (m) => m.name === 'contribution_after_ads',
        ).expression;
        const totals =
          await ava.query(`SELECT strftime(date,'%Y-%m') AS month, COUNT(*) AS rows,
        COUNT(DISTINCT date) AS days, ${revenue} AS net_revenue, ${contribution} AS contribution_after_ads
        FROM data GROUP BY 1 ORDER BY 1`);
        const segments = await ava.query(`SELECT sku, region, channel,
        SUM(CASE WHEN month(date)=2 THEN (gross_sales-discount_amount-COALESCE(refund_amount,0)-cogs-fulfillment_cost-platform_fee-ad_spend)/28
          ELSE -(gross_sales-discount_amount-COALESCE(refund_amount,0)-cogs-fulfillment_cost-platform_fee-ad_spend)/31 END) AS daily_change
        FROM data GROUP BY ALL ORDER BY daily_change`);
        return { key, quality, totals, segments };
      } finally {
        await ava.dispose();
      }
    },
    { csv, semantic },
  );
  expect(key).toEqual(['date', 'sku', 'region', 'channel']);
  expect(quality.truncated).toBeFalsy();
  expect(quality.data[0]).toMatchObject({
    rows: 1416,
    keys: 1416,
    days: 59,
    gross_error: 0,
    invalid: 0,
  });
  expect(quality.data[0].missing_refunds).toBeGreaterThan(0);
  expect(quality.data[0].zero_days).toBeGreaterThan(0);
  for (const row of totals.data) {
    const known = expected[row.month];
    expect(row.rows).toBe(known.rows);
    expect(row.days).toBe(known.days);
    expect(Math.abs(row.net_revenue - known.net_revenue)).toBeLessThan(0.001);
    expect(
      Math.abs(row.contribution_after_ads - known.contribution_after_ads),
    ).toBeLessThan(0.001);
  }
  expect(segments.data).toHaveLength(24);
  expect(segments.data[0]).toMatchObject({
    sku: 'COF-01',
    region: '华东',
    channel: '平台店',
  });
  const summed = segments.data.reduce(
    (total, row) => total + row.daily_change,
    0,
  );
  const overall =
    expected['2025-02'].contribution_after_ads / 28 -
    expected['2025-01'].contribution_after_ads / 31;
  expect(Math.abs(summed - overall)).toBeLessThan(0.001);
  expect(segments.data.some((row) => row.daily_change > 0)).toBe(true);
});
