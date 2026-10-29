import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function metrics(page) {
  return page.evaluate(() => ({
    longTasks: window.__tasks,
    maxFrameGapMs: window.__frameGap,
    navigation: performance.getEntriesByType('navigation')[0].toJSON(),
    resources: performance
      .getEntriesByType('resource')
      .map(({ name, transferSize }) => ({ name, transferSize })),
  }));
}
async function measure(page) {
  await page.addInitScript(() => {
    window.__tasks = [];
    window.__frameGap = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.__tasks.push({
          start: entry.startTime,
          duration: entry.duration,
        });
    }).observe({ type: 'longtask', buffered: true });
    let last;
    function frame(now) {
      if (last !== undefined)
        window.__frameGap = Math.max(window.__frameGap, now - last);
      last = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

test('measure cold page and 100000-row CSV responsiveness on a 4x slower CPU', async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.use.browserName !== 'chromium',
    'Chrome CDP performance sampling',
  );
  test.setTimeout(120000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await measure(page);
  const started = Date.now();
  await page.goto('/');
  await expect(page.locator('input[type=file]')).toBeEnabled();
  const readyMs = Date.now() - started;
  expect(
    (await metrics(page)).resources.filter(({ name }) => /\.wasm|index\.min-.*\.js/.test(name)),
  ).toHaveLength(0);
  const columns = [
    'region',
    'sales',
    ...Array.from({ length: 8 }, (_, i) => `category_${i}`),
  ];
  const csv =
    columns.join(',') +
    '\n' +
    Array.from({ length: 100000 }, (_, i) =>
      [
        'East',
        i % 100,
        ...Array.from({ length: 8 }, (_, j) => `group${(i + j) % 100}`),
      ].join(','),
    ).join('\n');
  const path = info.outputPath('large.csv');
  await writeFile(path, csv);
  const uploadStarted = Date.now();
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(
    page.getByText('large.csv', { exact: true }).first(),
  ).toBeVisible({ timeout: 60000 });
  const uploadMs = Date.now() - uploadStarted;
  const result = {
    environment:
      'Chrome headless, local uncompressed preview server, CPU slowed 4x',
    readyMs,
    uploadMs,
    bytes: Buffer.byteLength(csv),
    ...(await metrics(page)),
  };
  expect(uploadMs).toBeLessThan(10000);
  expect(
    Math.max(0, ...result.longTasks.map((task) => task.duration)),
  ).toBeLessThan(500);
  console.log(
    'PERFORMANCE',
    JSON.stringify({
      readyMs,
      uploadMs,
      bytes: result.bytes,
      maxFrameGapMs: result.maxFrameGapMs,
      longestTaskMs: Math.max(0, ...result.longTasks.map((t) => t.duration)),
    }),
  );
  await info.attach('performance.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});

test('unknown saved-run link can recover to a new analysis', async ({
  page,
}) => {
  await page.goto('/?run=record-that-does-not-exist');
  await expect(page.locator('.global-error')).toBeVisible();
  await page.getByRole('button', { name: '新建分析', exact: true }).click();
  await expect(page).not.toHaveURL(/run=/);
  await expect(page.locator('input[type=file]')).toBeEnabled();
});

test('large cell headers and dangerous names remain ordinary CSV data', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('input[type=file]')).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({
    name: 'headers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '__proto__,constructor,<img src=x onerror=alert(1)>\na,b,c\n',
    ),
  });
  await expect(
    page.getByText('headers.csv', { exact: true }).first(),
  ).toBeVisible();
  expect(await page.locator('main img').count()).toBe(0);
  await page
    .getByRole('textbox', { name: '分析问题', exact: true })
    .fill('test');
  await expect(
    page.getByRole('button', { name: '开始分析', exact: true }),
  ).toBeEnabled();
});

test('mobile viewport can upload and reach model settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('input[type=file]')).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({
    name: 'mobile.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('region,sales\nEast,3\n'),
  });
  await page
    .getByRole('textbox', { name: '分析问题', exact: true })
    .fill('sales');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('API Key', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('history growth has bounded startup and the first saved notebook still opens', async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.use.browserName !== 'chromium',
    'Chrome CDP performance sampling',
  );
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.locator('input[type=file]')).toBeEnabled();
  const { readFile } = await import('node:fs/promises');
  const sample = JSON.parse(
    await readFile(
      new URL('../../examples/classic/generated/cases.json', import.meta.url),
      'utf8',
    ),
  )[0];
  await page.evaluate(
    ({ sample }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('ava-notebook-direct', 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('runs', 'readwrite');
          for (let i = 0; i < 300; i++) {
            const run = {
              ...sample,
              caseStudy: undefined,
              id: `history-${i}`,
              question: `History ${i}`,
              createdAt: new Date(Date.now() - i * 1000).toISOString(),
            };
            tx.objectStore('runs').put(run, run.id);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { sample },
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await measure(page);
  const start = Date.now();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'History 0', exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  const result = {
    historyCount: 300,
    readyMs: Date.now() - start,
    ...(await metrics(page)),
  };
  expect(result.readyMs).toBeLessThan(5000);
  console.log(
    'HISTORY_PERFORMANCE',
    JSON.stringify({
      readyMs: result.readyMs,
      maxFrameGapMs: result.maxFrameGapMs,
      longestTaskMs: Math.max(0, ...result.longTasks.map((t) => t.duration)),
    }),
  );
  await info.attach('history-performance.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  await page.getByRole('button', { name: 'History 0', exact: true }).click();
  await expect(page).toHaveURL(/run=history-0/);
});

test('very wide CSV is rejected without rendering thousands of columns', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('input[type=file]')).toBeEnabled();
  const csv =
    Array.from({ length: 1000 }, (_, i) => `field${i}`).join(',') +
    '\n' +
    Array(1000).fill('1').join(',');
  await page.locator('input[type=file]').setInputFiles({
    name: 'wide.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.locator('.global-error')).toContainText(
    'CSV 最多支持 200 个字段',
  );
  await expect(page.locator('input[type=file]')).toBeEnabled();
  expect(await page.locator('main th').count()).toBeLessThan(200);
});
