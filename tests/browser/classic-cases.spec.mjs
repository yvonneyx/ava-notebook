import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const cases = JSON.parse(
  await readFile('examples/classic/generated/cases.json', 'utf8'),
);

for (const run of cases) {
  test(`classic case renders saved JSON charts: ${run.caseStudy.title}`, async ({
    page,
    context,
  }) => {
    const calls = [];
    context.on('request', (request) => {
      if (new URL(request.url()).pathname.includes('chat/completions'))
        calls.push(request.url());
    });
    await page.goto(`/?run=${run.id}`);
    await expect(page.locator('.notebook-paper')).toBeVisible();
    const results = run.nodes.filter(
      (node) => node.kind === 'result' && node.payload.data?.length,
    );
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const cell = page.locator(
        `[id=${JSON.stringify('step-' + result.parents[0])}]`,
      );
      const chartTab = cell.getByRole('tab', { name: 'Chart', exact: true });
      const dataTab = cell.getByRole('tab', { name: 'Data', exact: true });
      await chartTab.scrollIntoViewIfNeeded();
      await expect(cell.getByRole('tab')).toHaveCount(2);
      await expect(chartTab).toHaveAttribute('aria-selected', 'true');
      expect(['ready', 'empty']).toContain(result.visualization?.status);
      if (result.visualization.status === 'ready') {
        const chart = cell.frameLocator('iframe[title="自动生成的图表"]');
        await expect(chart.locator('canvas, table').first()).toBeVisible();
        await expect(cell.getByRole('alert')).toHaveCount(0);
      } else {
        await expect(
          cell.getByText('这份结果不需要图表，可在 Data 查看'),
        ).toBeVisible();
      }
      await dataTab.click();
      await expect(cell.getByRole('tabpanel').getByRole('table')).toBeVisible();
      await expect(dataTab).toHaveAttribute('aria-selected', 'true');
      await dataTab.press('ArrowRight');
      await expect(chartTab).toBeFocused();
      await expect(chartTab).toHaveAttribute('aria-selected', 'true');
    }
    await page
      .getByRole('button', { name: /查看查询 \d+ 的详情/ })
      .first()
      .click();
    const detail = page.getByRole('complementary', { name: '节点详情' });
    await expect(detail.getByRole('tab')).toHaveCount(2);
    await expect(
      detail.getByRole('tab', { name: 'Chart', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await detail.getByText('查看 SQL', { exact: true }).click();
    await expect(detail.locator('.language-sql')).toBeVisible();
    await detail.getByRole('tab', { name: 'Data', exact: true }).click();
    await expect(detail.getByRole('tabpanel').getByRole('table')).toBeVisible();
    await page.reload();
    await expect(page.locator('.notebook-paper')).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Chart', exact: true }).first(),
    ).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '图谱', exact: true }).click();
    await expect(page.locator('.react-flow')).toBeVisible();
    expect(calls).toEqual([]);
  });
}

test('updated classic case preserves old personal charts in history and shows the fresh snapshot', async ({
  page,
}) => {
  const current = cases.find((run) => run.id === 'case-product-profitability');
  const old = structuredClone(current);
  old.createdAt = '2000-01-01T00:00:00Z';
  const result = old.nodes.find((node) => node.kind === 'result');
  old.nodes.push({
    id: 'old-personal-chart',
    kind: 'chart',
    sequence: old.nodes.length,
    title: '旧版个人图表',
    stepId: result.stepId,
    parents: [result.id],
    status: 'succeeded',
    payload: { rows: [{ label: 'Laptop', value: 115746.25 }] },
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '回顾：销售额高就更赚钱吗', exact: true }),
  ).toBeVisible();
  await page.evaluate(async (old) => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('ava-notebook-direct', 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('runs', 'readwrite');
      tx.objectStore('runs').put(old, old.id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, old);
  await page.goto('/?run=' + current.id);
  await page.getByRole('tab', { name: 'Chart', exact: true }).first().click();
  await expect(
    page
      .frameLocator('iframe[title="自动生成的图表"]')
      .first()
      .locator('canvas')
      .first(),
  ).toBeVisible();
  const stored = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('ava-notebook-direct', 1);
      request.onsuccess = () => resolve(request.result);
    });
    const result = await new Promise((resolve, reject) => {
      const request = db.transaction('runs').objectStore('runs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  });
  expect(stored).toHaveLength(1);
  expect(stored[0].id).not.toBe(current.id);
  expect(stored[0].caseStudy).toBeUndefined();
  expect(stored[0].nodes).toEqual(old.nodes);
});

test('chart shows a loading state while its renderer downloads', async ({ page }) => {
  let release;
  const rendererReady = new Promise((resolve) => { release = resolve; });
  await page.route('**/assets/index.min-*.js', async (route) => {
    await rendererReady;
    await route.continue();
  });
  await page.goto(`/?run=${cases[0].id}`, { waitUntil: 'domcontentloaded' });
  const cell = page.locator('.generated-chart-container').first();
  await cell.scrollIntoViewIfNeeded();
  await expect(cell.getByRole('status')).toHaveText('正在加载图表…');
  release();
  await expect(cell.getByRole('status')).toHaveCount(0);
  await expect(cell.locator('iframe').contentFrame().locator('canvas, table').first()).toBeVisible();
});
