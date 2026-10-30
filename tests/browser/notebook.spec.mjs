import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

let provider, baseURL;
const requests = [];
const delayedCharts = [];
test.beforeAll(async () => {
  provider = createServer(async (request, response) => {
    const cors = !request.url.startsWith('/no-cors');
    if (cors) {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader(
        'Access-Control-Allow-Headers',
        'authorization, content-type',
      );
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const prompt = body.messages.map((message) => message.content).join('\n');
    requests.push({ auth: request.headers.authorization, prompt });
    if ('response_format' in body) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: { message: 'This response_format type is unavailable now' },
        }),
      );
      return;
    }
    if (
      prompt.includes('hold-browser-test') ||
      (prompt.includes('hold-summary-chart-test') &&
        prompt.includes(
          'Query result (including schema and truncation details):',
        ))
    )
      return;
    if (prompt.includes('provider-error-test')) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({ error: { message: 'Invalid key browser-test-key' } }),
      );
      return;
    }
    const advisor = prompt.startsWith('你是一个图表推荐专家');
    const chart = prompt.startsWith('你是一个 GPT-Vis 可视化专家');
    if (chart && prompt.includes('chart-failure-test')) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: { message: 'Invalid chart key browser-test-key' },
        }),
      );
      return;
    }
    if (chart && prompt.includes('slow-chart-test'))
      await new Promise((resolve) => delayedCharts.push(resolve));
    const chartRows = chart
      ? JSON.parse(prompt.split('**数据**:\n```json\n')[1].split('\n```')[0])
      : [];
    const loop = prompt.includes('# 1. RESPONSE PROTOCOL');
    const iteration = (prompt.match(/Assistant:\n/g) || []).length;
    const text = advisor
      ? prompt.includes('chart-empty-test')
        ? 'none'
        : 'column'
      : chart
      ? JSON.stringify({
          type: 'column',
          title: 'Generated sales',
          data: chartRows.map((row, i) => ({
            category: row.region || `Row ${i + 1}`,
            value: row.total ?? row.sales,
          })),
        })
      : loop
      ? [
          prompt.includes('many-chart-test')
            ? '[EXPLORE]\n```sql\nSELECT sales FROM data LIMIT 1\n```\n```sql\nSELECT sales FROM data LIMIT 2\n```\n```sql\nSELECT sales FROM data WHERE sales > 5\n```'
            : '[EXPLORE]\n```sql\nSELECT missing_column FROM data\n```\n```sql\nSELECT sales FROM data LIMIT 2\n```',
          '[SQL]\n```sql\nSELECT SUM(sales) AS total FROM data\n```',
          '[CONFIRM] Sales total is 10; verified against the source rows.',
        ][Math.min(iteration, 2)]
      : prompt.includes(
          'Query result (including schema and truncation details):',
        )
      ? JSON.stringify({
          queryExplanation: 'Sum sales across all rows.',
          conclusion: prompt.includes('large-browser-test')
            ? 'Sales total is 4950000.'
            : 'Sales total is 10.',
          limitations: 'Only this CSV is included.',
        })
      : prompt.includes('retry-browser-test') &&
        !prompt.includes('Previous DSL:')
      ? 'SELECT missing_column FROM data'
      : prompt.includes('empty-result-chart-test')
      ? 'SELECT sales FROM data WHERE 1=0'
      : 'SELECT SUM(sales) AS total FROM data';
    if (prompt.includes('cross-tab-completion'))
      await new Promise((resolve) => setTimeout(resolve, 2000));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'browser-test',
        object: 'chat.completion',
        created: 0,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
      }),
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${provider.address().port}`;
});
test.afterEach(() => {
  for (const resolve of delayedCharts.splice(0)) resolve();
});
test.afterAll(async () => {
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
});

async function configure(page, url = `${baseURL}/v1`) {
  await page.getByRole('button', { name: '配置分析模型', exact: true }).click();
  await page.getByLabel('API 地址', { exact: true }).fill(url);
  await page.getByLabel('模型名称', { exact: true }).fill('test-model');
  await page.getByLabel('API Key', { exact: true }).fill('browser-test-key');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
async function upload(page, question, strategy = 'direct') {
  await expect(page.locator('input[type=file]')).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({
    name: 'sales.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('region,sales\nEast,3\nWest,7\n'),
  });
  await expect(
    page.getByText('sales.csv', { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: '分析问题', exact: true })
    .fill(question);
  await page.getByLabel('分析模式', { exact: true }).selectOption(strategy);
  await expect(
    page.getByRole('button', { name: '开始分析', exact: true }),
  ).toBeEnabled();
}
async function records(page, store = 'runs') {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('ava-notebook-direct', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      }),
    store,
  );
}
async function currentRecord(page, status) {
  await expect(page).toHaveURL(/run=/);
  const id = new URL(page.url()).searchParams.get('run');
  await expect
    .poll(
      async () => {
        const run = (await records(page)).find((run) => run.id === id);
        if (run?.status === 'failed' && status !== 'failed')
          throw new Error(
            JSON.stringify({ status: run.status, error: run.error }),
          );
        return run?.status;
      },
      { timeout: 60000 },
    )
    .toBe(status);
  return (await records(page)).find((run) => run.id === id);
}

test('AVA browser DuckDB executes real SQL, profiles, bounds results and rejects writes', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5174/tests/browser/engine.html');
  await page.waitForFunction(() => window.createEngine);
  const result = await page.evaluate(async () => {
    const engine = window.createEngine();
    try {
      await engine.load({
        type: 'csv',
        options: { csv: 'region,sales\n"East, Coast",3\nWest,7\n' },
      });
      const schema = await engine.schema();
      const profile = await engine.profile(schema, {
        metrics: ['row_count', 'null_count'],
      });
      const sum = await engine.execute(
        'WITH totals AS (SELECT SUM(sales) AS total FROM data) SELECT * FROM totals;',
      );
      const bounded = await engine.execute('SELECT * FROM data', {
        maxRows: 1,
      });
      const precise = await engine.execute(
        "SELECT 9007199254740993::BIGINT AS n, '123456789.123456789'::DECIMAL(25,9) AS d, ';' AS literal",
      );
      const rejected = [];
      for (const sql of [
        'DELETE FROM data',
        'DROP TABLE data',
        'SELECT 1; DELETE FROM data',
        'SELECT 1) AS x; DROP TABLE data; --',
        "SELECT * FROM read_csv('https://example.com/private.csv')",
      ]) {
        try {
          await engine.execute(sql);
          rejected.push(false);
        } catch {
          rejected.push(true);
        }
      }
      const after = await engine.execute(
        'SELECT SUM(sales) AS total FROM data',
      );
      return { schema, profile, sum, bounded, precise, rejected, after };
    } finally {
      await engine.dispose();
    }
  });
  expect(result.schema.models[0].columns.map((column) => column.name)).toEqual([
    'region',
    'sales',
  ]);
  expect(result.profile.models[0].metrics.row_count).toBe(2);
  expect(result.sum.data).toEqual([{ total: 10 }]);
  expect(result.bounded.data).toHaveLength(1);
  expect(result.bounded.truncatedBy).toBe('maxRows');
  expect(result.precise.data).toEqual([
    { n: '9007199254740993', d: '123456789.123456789', literal: ';' },
  ]);
  expect(result.rejected).toEqual([true, true, true, true, true]);
  expect(result.after.data).toEqual([{ total: 10 }]);
});

test('production Notebook runs direct without response_format, retries SQL, renders charts and restores records', async ({
  page,
  context,
}) => {
  const apiCalls = [];
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiCalls.push(request.url());
  });
  await page.goto('/');
  await configure(page);
  await upload(page, 'retry-browser-test sum sales');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  const run = await currentRecord(page, 'completed');
  expect(run.nodes.filter((node) => node.kind === 'query')).toHaveLength(2);
  const result = run.nodes.find((node) => node.kind === 'result');
  expect(result.payload.data).toEqual([{ total: 10 }]);
  expect(run.events.some((event) => event.type === 'summarizeend')).toBe(true);
  await expect(
    page.getByText('Sales total is 10.', { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '图谱', exact: true }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.getByRole('button', { name: 'Notebook', exact: true }).click();
  await page.getByLabel('查看查询 2 的 SQL', { exact: true }).click();
  await page
    .getByRole('button', { name: '查看查询 2 的详情', exact: true })
    .click();
  await page
    .getByRole('complementary')
    .last()
    .getByRole('tab', { name: 'Chart', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await records(page))
          .find((item) => item.id === run.id)
          ?.nodes.find((item) => item.id === result.id)?.visualization?.status,
    )
    .toBe('ready');
  const chart = page.frameLocator('iframe[title="自动生成的图表"]').last();
  await expect(chart.locator('canvas').first()).toBeVisible();
  const saved = (await records(page)).find((item) => item.id === run.id);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出证据', exact: true }).click();
  const exported = await download;
  const json = JSON.parse(await readFile(await exported.path(), 'utf8'));
  expect(json.run.events.length).toBeGreaterThan(0);
  const visualization = json.run.nodes.find(
    (item) => item.id === result.id,
  ).visualization;
  expect(visualization.config.data).toEqual([{ category: 'Row 1', value: 10 }]);
  expect(visualization).not.toHaveProperty('html');
  expect(JSON.stringify(json)).not.toContain('browser-test-key');
  const url = page.url();
  await page.reload();
  await expect(
    page.getByText('Sales total is 10.', { exact: true }).first(),
  ).toBeVisible();
  expect((await currentRecord(page, 'completed')).nodes).toEqual(saved.nodes);
  await page.getByRole('button', { name: '配置分析模型', exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('test-model');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute(
    'placeholder', '已配置，留空保持当前密钥',
  );
  await page.getByLabel('模型名称', { exact: true }).fill('updated-model');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: '配置分析模型', exact: true }).click();
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('updated-model');
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute(
    'placeholder', '已配置，留空保持当前密钥',
  );
  expect(await records(page, 'sources')).toHaveLength(1);
  expect(JSON.stringify(await records(page, 'runs'))).not.toContain('browser-test-key');
  expect(page.url()).toBe(url);
  expect(apiCalls).toEqual([]);
});

test('Loop explores, corrects SQL and verifies results', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'loop-browser-test sum sales', 'loop');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  const run = await currentRecord(page, 'completed');
  expect(run.nodes.filter((node) => node.kind === 'query')).toHaveLength(3);
  expect(run.nodes.some((node) => node.payload.action === 'CONFIRM')).toBe(
    true,
  );
  expect(run.result.data).toEqual([{ total: 10 }]);
  await expect
    .poll(async () =>
      (await currentRecord(page, 'completed')).nodes
        .filter((node) => node.kind === 'result')
        .map((node) => node.visualization?.status),
    )
    .toEqual(['ready', 'ready']);
  const saved = await currentRecord(page, 'completed');
  for (const result of saved.nodes.filter((node) => node.kind === 'result'))
    expect(result.visualization.config.data.map((row) => row.value)).toEqual(
      result.payload.data.map((row) => row.total ?? row.sales),
    );
  expect(
    requests.some((request) => request.auth === 'Bearer browser-test-key'),
  ).toBe(true);
});

test('stop terminates a worker, other tabs preserve live runs, reload marks abandoned runs interrupted', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'hold-browser-test');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  await expect
    .poll(
      () =>
        requests.filter((request) =>
          request.prompt.includes('hold-browser-test'),
        ).length,
    )
    .toBeGreaterThan(0);
  const tab = await context.newPage();
  await tab.goto('/');
  await expect(
    tab.getByRole('button', { name: '开始分析', exact: true }),
  ).toBeVisible();
  await currentRecord(page, 'running');
  await tab
    .getByRole('navigation', { name: '分析历史' })
    .getByRole('button', { name: 'hold-browser-test', exact: true })
    .hover();
  await tab.getByRole('button', { name: /^停止并删除分析：/ }).click();
  await expect(tab.locator('.global-error')).toContainText(
    '此分析正在另一个页面运行',
  );
  await currentRecord(page, 'running');
  await tab.close();
  await page.getByRole('button', { name: '停止分析', exact: true }).click();
  await currentRecord(page, 'cancelled');
  await page.getByRole('button', { name: '新建分析', exact: true }).click();
  await upload(page, 'hold-browser-test refresh');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  await currentRecord(page, 'running');
  await page.reload();
  await currentRecord(page, 'interrupted');
});

test('provider failures are redacted and CORS failures retain a failed notebook', async ({
  page,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'provider-error-test');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  const failed = await currentRecord(page, 'failed');
  expect(JSON.stringify(failed)).not.toContain('browser-test-key');
  await page.getByRole('button', { name: '新建分析', exact: true }).click();
  await configure(page, `${baseURL}/no-cors/v1`);
  await upload(page, 'CORS test');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  await currentRecord(page, 'failed');
});

test('browser engine timeout terminates the worker and permits reloading the source', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5174/tests/browser/engine.html');
  await page.waitForFunction(() => window.createEngine);
  const outcome = await page.evaluate(async () => {
    const engine = window.createEngine({ queryTimeoutMs: 1000 });
    const source = { type: 'csv', options: { csv: 'n\n1\n2\n' } };
    let error;
    try {
      await engine.load(source);
      try {
        await engine.execute(
          'SELECT SUM(a.i * b.i) FROM range(100000) a(i), range(100000) b(i)',
        );
      } catch (caught) {
        error = caught.message;
      }
      await engine.load(source);
      return {
        error,
        result: await engine.execute('SELECT SUM(n) AS total FROM data'),
      };
    } finally {
      await engine.dispose();
    }
  });
  expect(outcome.error).toContain('timed out');
  expect(outcome.result.data).toEqual([{ total: 3 }]);
});

test('storage failure stops analysis and keeps unsaved evidence available for export', async ({
  page,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'storage failure test');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'runs' && value.events?.length >= 3)
        throw new DOMException('Test quota exhausted', 'QuotaExceededError');
      return original.call(this, value, ...args);
    };
  });
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  await expect(page.locator('.run-error')).toContainText(
    '浏览器保存失败，分析已停止。请检查网站存储空间并导出已有结果。',
    { timeout: 30000 },
  );
  await expect(
    page.getByRole('button', { name: '停止分析', exact: true }),
  ).not.toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出证据', exact: true }).click();
  const download = await pending;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.run.status).toBe('failed');
  expect(exported.run.events.length).toBeGreaterThanOrEqual(3);
  expect(JSON.stringify(exported)).not.toContain('browser-test-key');
});

test('failed Wasm download ends with a usable failed notebook', async ({
  page,
  context,
}) => {
  await context.route('**/*.wasm', (route) => route.abort());
  await page.goto('/');
  await configure(page);
  await upload(page, 'download failure');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  await expect
    .poll(
      async () =>
        (
          await records(page)
        ).find((run) => run.id === new URL(page.url()).searchParams.get('run'))
          ?.status,
      { timeout: 15000 },
    )
    .toBe('failed');
  await page.getByRole('button', { name: '新建分析', exact: true }).click();
  await expect(page.locator('input[type=file]')).toBeEnabled();
});

test('stop while Wasm is downloading is immediate and leaves no late update', async ({
  page,
}) => {
  let requested = false;
  await page.route('**/*.wasm', async (route) => {
    requested = true;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue().catch(() => {});
  });
  await page.goto('/');
  await configure(page);
  await upload(page, 'slow download');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  const start = Date.now();
  await page.getByRole('button', { name: '停止分析', exact: true }).click();
  const cancelled = await currentRecord(page, 'cancelled');
  expect(Date.now() - start).toBeLessThan(1500);
  await page.waitForTimeout(3200);
  expect((await currentRecord(page, 'cancelled')).revision).toBe(
    cancelled.revision,
  );
});

test('missing DuckDB worker script fails instead of waiting forever', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5174/tests/browser/engine.html');
  await page.waitForFunction(() => window.createEngine);
  const error = await page.evaluate(async () => {
    const bundles = structuredClone(window.bundles);
    for (const bundle of Object.values(bundles))
      bundle.mainWorker = `${location.origin}/missing-worker.js`;
    const engine = window.createEngine({ bundles });
    try {
      await engine.load({ type: 'csv', options: { csv: 'a\n1\n' } });
      return '';
    } catch (error) {
      return error.message;
    } finally {
      await engine.dispose();
    }
  });
  expect(error).toContain('worker failed to load');
});

test('two tabs saving charts cannot overwrite each other', async ({
  page,
  context,
}) => {
  const legacy = JSON.parse(
    await readFile('examples/classic/generated/cases.json', 'utf8'),
  ).find((run) => run.id === 'case-product-profitability');
  legacy.id = 'legacy-manual-charts';
  delete legacy.caseStudy;
  for (const node of legacy.nodes) delete node.visualization;
  const successful =
    legacy.nodes
      .filter((node) => node.kind === 'query')
      .findIndex((node) => node.status === 'succeeded') + 1;
  const row = legacy.nodes.find((node) => node.kind === 'result').payload
    .data[0];
  const category = Object.keys(row).find(
    (name) => typeof row[name] === 'string',
  );
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '回顾：销售额高就更赚钱吗', exact: true }),
  ).toBeVisible();
  await page.evaluate(async (run) => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('ava-notebook-direct', 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('runs', 'readwrite');
      tx.objectStore('runs').put(run, run.id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, legacy);
  await page.goto('/?run=' + legacy.id);
  const other = await context.newPage();
  await other.goto(page.url());
  async function selectChart(tab) {
    await tab
      .getByLabel(`查看查询 ${successful} 的 SQL`, { exact: true })
      .click();
    await tab
      .getByRole('button', {
        name: `查看查询 ${successful} 的详情`,
        exact: true,
      })
      .click();
    const detail = tab.getByRole('complementary').last();
    await detail.getByRole('tab', { name: 'Chart', exact: true }).click();
    await detail
      .getByLabel('图表分类列', { exact: true })
      .selectOption(category);
  }
  await selectChart(page);
  await selectChart(other);
  await Promise.all([
    page.getByRole('button', { name: '保存图表', exact: true }).click(),
    other.getByRole('button', { name: '保存图表', exact: true }).click(),
  ]);
  await expect
    .poll(
      async () =>
        (
          await currentRecord(page, 'completed')
        ).nodes.filter((node) => node.kind === 'chart').length,
    )
    .toBe(2);
  await other.close();
});

test('a second tab receives completion updates without refreshing', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'cross-tab-completion');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect(page).toHaveURL(/run=/);
  const other = await context.newPage();
  await other.goto(page.url());
  await currentRecord(page, 'completed');
  await expect(other.locator('.run-summary [role=status]')).toHaveText(
    '已完成',
    { timeout: 15000 },
  );
  await other.close();
});

test('100000 rows execute repeatedly without blocking the page or growing its heap without bound', async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.use.browserName !== 'chromium',
    'Chrome CDP performance measurement',
  );
  test.setTimeout(120000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__analysisTasks = [];
    new PerformanceObserver((list) =>
      window.__analysisTasks.push(...list.getEntries().map((e) => e.duration)),
    ).observe({ type: 'longtask' });
  });
  await page.goto('/');
  await configure(page);
  const { writeFile } = await import('node:fs/promises');
  const path = info.outputPath('repeated-large.csv');
  await writeFile(
    path,
    'region,sales\n' +
      Array.from({ length: 100000 }, (_, i) => `East,${i % 100}`).join('\n'),
  );
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await cdp.send('Runtime.getHeapUsage');
  const times = [];
  for (let i = 0; i < 5; i++) {
    if (i)
      await page.getByRole('button', { name: '新建分析', exact: true }).click();
    await expect(page.locator('input[type=file]')).toBeEnabled();
    await page.locator('input[type=file]').setInputFiles(path);
    await expect(
      page.getByText('repeated-large.csv', { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: '分析问题', exact: true })
      .fill('large-browser-test sum sales');
    const start = Date.now();
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await expect(page).toHaveURL(/run=/);
    const run = await currentRecord(page, 'completed');
    expect(run.result.data).toEqual([{ total: 4950000 }]);
    times.push(Date.now() - start);
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await cdp.send('Runtime.getHeapUsage');
  const mainTasks = await page.evaluate(() => window.__analysisTasks);
  const result = {
    rows: 100000,
    cpuSlowdown: 4,
    analysisMs: times,
    mainHeapBefore: before.usedSize,
    mainHeapAfter: after.usedSize,
    longestMainTaskMs: Math.max(0, ...mainTasks),
  };
  console.log('ANALYSIS_PERFORMANCE', JSON.stringify(result));
  await info.attach('analysis-performance.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(after.usedSize - before.usedSize).toBeLessThan(20 * 1024 * 1024);
  expect(result.longestMainTaskMs).toBeLessThan(500);
});

test('engine initialization has a deadline when the network stalls', async ({
  page,
  context,
}) => {
  await context.route('**/*.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue().catch(() => {});
  });
  await page.goto('http://127.0.0.1:5174/tests/browser/engine.html');
  await page.waitForFunction(() => window.createEngine);
  const error = await page.evaluate(async () => {
    const engine = window.createEngine({ loadTimeoutMs: 300 });
    try {
      await engine.load({ type: 'csv', options: { csv: 'n\n1\n' } });
      return '';
    } catch (error) {
      return error.message;
    } finally {
      await engine.dispose();
    }
  });
  expect(error).toContain('initialization timed out');
});

test('query memory exhaustion stays in the worker and the engine can run another query', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5174/tests/browser/engine.html');
  await page.waitForFunction(() => window.createEngine);
  const outcome = await page.evaluate(async () => {
    const engine = window.createEngine({ memoryLimit: '64MB' });
    try {
      await engine.load({ type: 'csv', options: { csv: 'n\n1\n' } });
      let error;
      try {
        await engine.execute(
          'SELECT SUM(a.i*b.i) FROM range(100000000) a(i), range(100000000) b(i)',
        );
      } catch (caught) {
        error = caught.message;
      }
      return {
        error,
        result: await engine.execute('SELECT SUM(n) AS total FROM data'),
      };
    } finally {
      await engine.dispose();
    }
  });
  expect(outcome.error).toContain('Out of Memory');
  expect(outcome.result.data).toEqual([{ total: 1 }]);
});

test('chart generation finishes after analysis, updates another tab and does not block a new run', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'slow-chart-test background');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const original = await currentRecord(page, 'completed');
  await expect
    .poll(
      async () =>
        (await records(page))
          .find((run) => run.id === original.id)
          ?.nodes.find((node) => node.kind === 'result')?.visualization?.status,
    )
    .toBe('pending');
  await page.getByRole('tab', { name: 'Chart', exact: true }).first().click();
  await expect(
    page.getByText('图表正在异步生成，数据和分析可继续查看…'),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(page.url());
  await second.getByRole('tab', { name: 'Chart', exact: true }).first().click();
  await expect(
    second.getByText('图表正在异步生成，数据和分析可继续查看…'),
  ).toBeVisible();
  await page.getByRole('button', { name: '新建分析', exact: true }).click();
  await upload(page, 'another run while chart pending');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const next = await currentRecord(page, 'completed');
  expect(next.id).not.toBe(original.id);
  for (const resolve of delayedCharts.splice(0)) resolve();
  await expect(
    second
      .frameLocator('iframe[title="自动生成的图表"]')
      .locator('canvas')
      .first(),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await records(page))
          .find((run) => run.id === original.id)
          ?.nodes.find((node) => node.kind === 'result')?.visualization?.status,
    )
    .toBe('ready');
  expect(new URL(page.url()).searchParams.get('run')).toBe(next.id);
});

test('chart failure or no recommendation preserves the successful analysis and its data', async ({
  page,
}) => {
  await page.goto('/');
  await configure(page);
  for (const [question, status, message] of [
    ['chart-failure-test', 'failed', '图表生成失败'],
    ['chart-empty-test', 'empty', '这份结果不需要图表'],
  ]) {
    if (question !== 'chart-failure-test')
      await page.getByRole('button', { name: '新建分析', exact: true }).click();
    await upload(page, question);
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await currentRecord(page, 'completed');
    await expect
      .poll(
        async () =>
          (
            await currentRecord(page, 'completed')
          ).nodes.find((node) => node.kind === 'result')?.visualization?.status,
      )
      .toBe(status);
    const run = await currentRecord(page, 'completed');
    expect(run.result.data).toEqual([{ total: 10 }]);
    expect(JSON.stringify(run)).not.toContain('browser-test-key');
    await page.getByRole('tab', { name: 'Chart', exact: true }).first().click();
    await expect(
      page.locator('.view-empty').filter({ hasText: message }),
    ).toBeVisible();
    const output = page
      .locator('.cell-output')
      .filter({ has: page.getByRole('tablist') });
    await output.getByRole('tab', { name: 'Data', exact: true }).click();
    await expect(output.getByRole('table')).toContainText('10');
  }
});

test('refresh interrupts only pending charts, keeps the completed analysis and never regenerates it', async ({
  page,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'slow-chart-test refresh charts');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await currentRecord(page, 'completed');
  await expect.poll(() => delayedCharts.length).toBeGreaterThan(0);
  const calls = requests.filter((item) =>
    item.prompt.includes('refresh charts'),
  ).length;
  await page.reload();
  await expect
    .poll(
      async () =>
        (
          await currentRecord(page, 'completed')
        ).nodes.find((node) => node.kind === 'result')?.visualization?.status,
    )
    .toBe('interrupted');
  expect((await currentRecord(page, 'completed')).result.data).toEqual([
    { total: 10 },
  ]);
  expect(
    requests.filter((item) => item.prompt.includes('refresh charts')).length,
  ).toBe(calls);
});

test('stop cancels pending charts and deleting a completed run prevents late chart resurrection', async ({
  page,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'slow-chart-test hold-summary-chart-test');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  await expect.poll(() => delayedCharts.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '停止分析', exact: true }).click();
  const cancelled = await currentRecord(page, 'cancelled');
  expect(
    cancelled.nodes.find((node) => node.kind === 'result').visualization.status,
  ).toBe('cancelled');
  for (const resolve of delayedCharts.splice(0)) resolve();
  await page.getByRole('button', { name: '新建分析', exact: true }).click();
  await upload(page, 'slow-chart-test delete pending chart');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const completed = await currentRecord(page, 'completed');
  await expect.poll(() => delayedCharts.length).toBeGreaterThan(0);
  await page
    .getByRole('navigation', { name: '分析历史' })
    .getByRole('button', {
      name: 'slow-chart-test delete pending chart',
      exact: true,
    })
    .hover();
  await page
    .getByRole('button', {
      name: '删除分析：slow-chart-test delete pending chart',
      exact: true,
    })
    .click();
  await expect(page).not.toHaveURL(/run=/);
  for (const resolve of delayedCharts.splice(0)) resolve();
  await page.waitForTimeout(300);
  expect((await records(page)).some((run) => run.id === completed.id)).toBe(
    false,
  );
  expect(
    (await records(page)).find((run) => run.id === cancelled.id).status,
  ).toBe('cancelled');
});

test('empty query results do not request a visualization', async ({ page }) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'empty-result-chart-test');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const run = await currentRecord(page, 'completed');
  const result = run.nodes.find((node) => node.kind === 'result');
  expect(result.payload.data).toEqual([]);
  expect(result.visualization).toBeUndefined();
  expect(
    requests.filter(
      (item) =>
        item.prompt.startsWith('你是一个图表推荐专家') &&
        item.prompt.includes('empty-result-chart-test'),
    ),
  ).toHaveLength(0);
});

test('saved visualization JSON renders safely without exposing the Notebook page or loading external content', async ({
  page,
  context,
}) => {
  const external = [];
  context.on('request', (request) => {
    if (request.url().startsWith('https://chart-evil.test'))
      external.push(request.url());
  });
  await page.goto('/');
  await configure(page);
  await upload(page, 'safe chart render');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const run = await currentRecord(page, 'completed');
  await expect
    .poll(
      async () =>
        (
          await currentRecord(page, 'completed')
        ).nodes.find((node) => node.kind === 'result')?.visualization?.status,
    )
    .toBe('ready');
  const malicious =
    '</script><img src="https://chart-evil.test/leak" onerror="parent.__chartEscaped=true">';
  await page.evaluate(
    async ({ id, malicious }) => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open('ava-notebook-direct', 1);
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('runs', 'readwrite');
        const store = tx.objectStore('runs');
        const request = store.get(id);
        request.onsuccess = () => {
          const run = request.result;
          run.nodes.find((node) => node.kind === 'result').visualization = {
            status: 'ready',
            config: {
              type: 'table',
              title: 'Safe saved chart',
              data: [{ note: malicious }],
            },
          };
          store.put(run, id);
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { id: run.id, malicious },
  );
  await page.reload();
  await page.getByRole('tab', { name: 'Chart', exact: true }).first().click();
  const chart = page.frameLocator('iframe[title="自动生成的图表"]').first();
  await expect(chart.getByText(malicious, { exact: true })).toBeVisible();
  expect(await chart.locator('img').count()).toBe(0);
  expect(await page.evaluate(() => window.__chartEscaped)).toBeUndefined();
  expect(
    await chart.locator('body').evaluate(() => {
      try {
        return !!parent.document;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  expect(external).toEqual([]);
});

test('multiple query charts run with two requests at a time and queued results still finish', async ({
  page,
}) => {
  await page.goto('/');
  await configure(page);
  await upload(page, 'many-chart-test slow-chart-test', 'loop');
  await page.getByRole('button', { name: '开始分析', exact: true }).click();
  const run = await currentRecord(page, 'completed');
  expect(run.nodes.filter((node) => node.kind === 'result')).toHaveLength(4);
  await expect.poll(() => delayedCharts.length).toBe(2);
  for (const resolve of delayedCharts.splice(0)) resolve();
  await expect.poll(() => delayedCharts.length).toBe(2);
  for (const resolve of delayedCharts.splice(0)) resolve();
  await expect
    .poll(async () =>
      (await currentRecord(page, 'completed')).nodes
        .filter((node) => node.kind === 'result')
        .map((node) => node.visualization?.status),
    )
    .toEqual(['ready', 'ready', 'ready', 'ready']);
});
