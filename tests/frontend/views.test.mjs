import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let server,
  evidenceDatasets,
  chartPreview,
  numericColumns,
  EvidenceViews,
  Notebook,
  Detail,
  SqlCode,
  AnalysisText,
  Bars,
  notebookSteps,
  stepNarrative;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  ({ evidenceDatasets, chartPreview, numericColumns } =
    await server.ssrLoadModule('/src/domain/evidence.ts'));
  ({ default: EvidenceViews } = await server.ssrLoadModule(
    '/src/features/evidence/EvidenceViews.tsx',
  ));
  ({ default: Notebook } = await server.ssrLoadModule(
    '/src/features/notebook/Notebook.tsx',
  ));
  ({ default: Detail } = await server.ssrLoadModule(
    '/src/features/evidence/EvidenceDetail.tsx',
  ));
  ({ default: SqlCode } = await server.ssrLoadModule('/src/ui/SqlCode.tsx'));
  ({ default: AnalysisText } = await server.ssrLoadModule(
    '/src/ui/AnalysisText.tsx',
  ));
  ({ Bars } = await server.ssrLoadModule('/src/ui/BarChart.tsx'));
  ({ notebookSteps, stepNarrative } = await server.ssrLoadModule(
    '/src/features/notebook/steps.ts',
  ));
});
after(async () => {
  await server?.close();
});

const source = {
  id: 'csv',
  name: 'sales.csv',
  rows: 100,
  headers: ['region', 'sales'],
  preview: [{ region: 'East', sales: '12.5' }],
  bytes: 1024,
  hash: 'test',
};
const model0 = {
  id: 'm0',
  kind: 'translate',
  sequence: 1,
  title: '探索',
  parents: ['context'],
  status: 'succeeded',
  payload: {},
  stepId: 'step-a',
};
const q0 = {
  id: 'q0',
  kind: 'query',
  sequence: 2,
  title: '查询 1',
  parents: ['m0'],
  status: 'succeeded',
  payload: { sql: 'SELECT 2 AS value' },
  stepId: 'step-a',
};
const r0 = {
  id: 'r0',
  kind: 'result',
  sequence: 3,
  title: '结果 1',
  parents: ['q0'],
  status: 'succeeded',
  payload: { data: [{ value: 2 }], schema: [{ name: 'value' }], rowCount: 1 },
};
const q1 = {
  ...q0,
  id: 'q1',
  sequence: 4,
  title: '查询 2',
  payload: { sql: 'SELECT 3 AS value' },
};
const r1 = {
  ...r0,
  id: 'r1',
  sequence: 5,
  parents: ['q1'],
  payload: { ...r0.payload, data: [{ value: 3 }] },
};
const model1 = {
  ...model0,
  id: 'm1',
  sequence: 6,
  parents: ['m0', 'r0', 'r1'],
  stepId: 'step-b',
};
const conclusion = {
  id: 'end',
  kind: 'conclusion',
  sequence: 7,
  title: '结论',
  parents: ['m1'],
  status: 'completed',
  payload: { conclusion: '结果为 2。' },
};
const unrelated = {
  ...r1,
  id: 'unrelated',
  parents: ['missing'],
  sequence: 99,
  payload: { data: [{ value: 999 }] },
};
const run = {
  id: 'run',
  source,
  status: 'completed',
  nodes: [model0, q0, r0, q1, r1, model1, conclusion, unrelated],
};
const noop = () => {};
const render = (Component, props) =>
  renderToStaticMarkup(React.createElement(Component, props));

test('SQL highlighting preserves whitespace and safely separates literals, comments and identifiers', () => {
  const sql = `select\tSUM(sales), 1.5e-2, 'it''s <script>', "select", 销售额, select_count
FROM data -- SELECT 'ignored'
/* WHERE 123 */ WHERE sales >= .5;`;
  const html = render(SqlCode, { sql });
  assert.match(html, /class="sql-keyword">select<\/span>/);
  assert.match(html, /class="sql-function">SUM<\/span>/);
  assert.match(html, /class="sql-number">1\.5e-2<\/span>/);
  assert.match(html, /class="sql-number">\.5<\/span>/);
  assert.match(
    html,
    /class="sql-string">&#x27;it&#x27;&#x27;s &lt;script&gt;&#x27;<\/span>/,
  );
  assert.match(html, /class="sql-identifier">&quot;select&quot;<\/span>/);
  assert.match(
    html,
    /class="sql-comment">-- SELECT &#x27;ignored&#x27;<\/span>/,
  );
  assert.match(html, /class="sql-comment">\/\* WHERE 123 \*\/<\/span>/);
  assert.ok(html.includes('销售额, select_count\n'));
  assert.doesNotMatch(html, /<script>/);
  const escaped = renderToStaticMarkup(React.createElement('code', null, sql));
  assert.equal(
    html
      .replace(/<span[^>]*>|<\/span>/g, '')
      .replace(' class="language-sql"', ''),
    escaped,
  );
  assert.equal(render(SqlCode, {}), '<code class="language-sql"></code>');
});

test('notebook, evidence and Markdown SQL blocks share highlighting', () => {
  const props = { run, node: q0, onSelect: noop };
  for (const html of [
    render(Notebook, props),
    render(EvidenceViews, props),
    render(AnalysisText, { text: '```SQL\nSELECT 2 AS value\n```' }),
  ]) {
    assert.match(html, /class="sql-keyword">SELECT<\/span>/);
    assert.match(html, /class="sql-number">2<\/span>/);
  }
  const plain = render(AnalysisText, {
    text: '`SELECT`\n\n```text\nSELECT 2\n```',
  });
  assert.doesNotMatch(plain, /sql-keyword/);
  assert.match(plain, /<code>SELECT<\/code>/);
});

test('evidence views follow exact query/result edges, including multiple queries and conclusion ancestors', () => {
  for (const node of [q0, r0]) {
    const [data] = evidenceDatasets(run, node);
    assert.equal(data.query.id, 'q0');
    assert.equal(data.query.payload.sql, 'SELECT 2 AS value');
    assert.equal(data.result.id, 'r0');
    assert.deepEqual(data.rows, [{ value: 2 }]);
  }
  assert.deepEqual(
    evidenceDatasets(run, model0).map((item) => item.id),
    ['q0', 'q1'],
  );
  const input = evidenceDatasets(run, model1);
  assert.deepEqual(
    input.map((item) => item.id),
    ['q0', 'q1'],
  );
  assert.ok(input.every((item) => item.label.startsWith('输入依据')));
  assert.deepEqual(
    evidenceDatasets(run, conclusion).map((item) => item.id),
    ['q1', 'q0'],
  );
  const chart = { id: 'chart', kind: 'chart', parents: ['r0'], payload: {} };
  assert.deepEqual(
    evidenceDatasets(run, chart).map((item) => item.id),
    ['q0'],
  );
});

test('pending, failed, empty and missing evidence do not acquire another query’s data', () => {
  const pending = { ...q0, id: 'pending', status: 'running' };
  const branch = {
    ...run,
    nodes: [q0, r0, pending, unrelated],
  };
  assert.equal(evidenceDatasets(branch, pending)[0].rows, undefined);
  assert.equal(
    evidenceDatasets(branch, { ...pending, status: 'failed' })[0].rows,
    undefined,
  );
  const empty = { ...r0, payload: { ...r0.payload, data: [], rowCount: 0 } };
  assert.deepEqual(
    evidenceDatasets({ ...run, nodes: [q0, empty] }, q0)[0].rows,
    [],
  );
  assert.deepEqual(
    evidenceDatasets({ ...run, nodes: [q0, empty] }, q0)[0].columns,
    ['value'],
  );
  const cycle = { ...conclusion, parents: ['end', 'missing'] };
  assert.deepEqual(evidenceDatasets({ ...run, nodes: [cycle] }, cycle), []);
  assert.deepEqual(
    evidenceDatasets(run, { kind: 'translate', id: 'unknown', parents: [] }),
    [],
  );
  const [preview] = evidenceDatasets(run, { kind: 'source' });
  assert.equal(preview.query, undefined);
  assert.equal(preview.preview, true);
  assert.equal(preview.total, 100);
});

test('chart preview retains signed values, rejects invalid values, limits rows and distinguishes CSV strings', () => {
  const data = {
    columns: ['label', 'value', 'text'],
    rows: [
      { label: 'zero', value: 0, text: 'x' },
      { label: 'loss', value: -2, text: 'y' },
      { label: 'empty', value: null },
      { label: 'missing' },
      { label: 'invalid', value: Infinity },
    ],
    result: r0,
  };
  assert.deepEqual(numericColumns(data), ['value']);
  assert.deepEqual(chartPreview(data, 'label', 'value').rows, [
    { label: 'zero', value: 0 },
    { label: 'loss', value: -2 },
  ]);
  assert.equal(chartPreview(data, 'label', 'value').omitted, 3);
  assert.equal(chartPreview(data, 'label', 'value').canSave, false);
  const valid = {
    ...data,
    rows: [
      { label: 'A', value: 0 },
      { label: 'B', value: -2 },
    ],
  };
  assert.equal(chartPreview(valid, 'label', 'value').canSave, true);
  assert.equal(chartPreview(valid, '', 'value').canSave, false);
  const csv = evidenceDatasets(run, { kind: 'source' })[0];
  assert.deepEqual(numericColumns(csv), ['sales']);
  assert.deepEqual(chartPreview(csv, 'region', 'sales').rows, [
    { label: 'East', value: 12.5 },
  ]);
  assert.deepEqual(numericColumns({ ...csv, preview: false }), []);
  assert.deepEqual(
    numericColumns({
      columns: ['empty', 'bool'],
      rows: [{ empty: ' ', bool: false }],
      preview: true,
    }),
    [],
  );
  const large = {
    ...valid,
    rows: Array.from({ length: 25 }, (_, index) => ({
      label: index,
      value: index,
    })),
  };
  assert.equal(chartPreview(large, 'label', 'value').rows.length, 20);
  assert.equal(chartPreview(large, 'label', 'value').limited, true);
  assert.equal(
    chartPreview({ ...valid, truncated: true }, 'label', 'value').limited,
    true,
  );
});

test('every evidence kind defaults to Chart with two accessible tabs and retains source and empty states', () => {
  const chart = {
    id: 'chart',
    kind: 'chart',
    title: 'chart',
    parents: ['r0'],
    payload: { x: '', y: 'value' },
  };
  for (const node of [
    q0,
    r0,
    model0,
    conclusion,
    { kind: 'source', title: 'CSV' },
    { kind: 'context', title: '结构' },
    chart,
  ]) {
    const html = render(EvidenceViews, { node, run, onSelect: noop });
    assert.equal((html.match(/role="tab"/g) || []).length, 2);
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
    assert.match(html, /id="[^"]+-chart"[^>]+aria-selected="true"/);
    assert.match(html, /role="tabpanel"/);
  }
  const sourceHtml = render(EvidenceViews, {
    node: { kind: 'source', title: 'CSV' },
    run,
    onSelect: noop,
  });
  assert.match(sourceHtml, /CSV 预览 · 1 \/ 100 行/);
  const empty = { ...r0, payload: { ...r0.payload, data: [] } };
  assert.match(
    render(EvidenceViews, {
      node: empty,
      run: { ...run, nodes: [q0, empty] },
      onSelect: noop,
    }),
    /没有结果行可供绘图/,
  );
  assert.match(
    render(EvidenceViews, { node: model0, run, onSelect: noop }),
    /选择关联查询/,
  );
  const chartHtml = render(EvidenceViews, { node: chart, run, onSelect: noop });
  assert.match(chartHtml, /图表数值列/);
  assert.match(chartHtml, /柱状图/);
});

test('bar charts use a shared zero baseline instead of drawing negative values as positive', () => {
  const html = render(Bars, {
    title: 'signed',
    rows: [
      { label: 'loss', value: -10 },
      { label: 'gain', value: 10 },
      { label: 'zero', value: 0 },
    ],
  });
  assert.match(html, /class="negative" style="left:0%;width:50%"/);
  assert.match(html, /style="left:50%;width:50%"/);
  assert.match(html, /style="left:50%;width:0%"/);
});

test('new direct events group retries, display the report and preserve every node anchor', async () => {
  const { directRun } = await import('../fixtures/direct-events.mjs');
  const quick = { ...directRun(), source };
  const steps = notebookSteps(quick);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].nodes.length, quick.nodes.length);
  assert.deepEqual(evidenceDatasets(quick, steps[0].node).at(-1).rows, [
    { total: 10 },
  ]);
  const narrative = stepNarrative(quick, steps[0]);
  assert.equal(narrative.conclusion, '销售总额为 10。');
  const html = render(Notebook, { run: quick, onSelect: noop });
  const visibleText = html.replace(/<[^>]*>/g, '');
  for (const label of [
    '查询说明',
    narrative.introduction,
    'SELECT SUM(sales)',
    '证据局限',
    narrative.limitations,
    '分析结论',
    narrative.conclusion,
    '后续计划',
    narrative.nextStep,
  ])
    assert.ok(visibleText.includes(label), label);
  assert.ok(
    visibleText.indexOf('查询说明') < visibleText.indexOf('SELECT SUM(sales)'),
  );
  assert.ok(
    visibleText.indexOf('SELECT SUM(sales)') <
      visibleText.indexOf('结果 · 1 行'),
  );
  assert.ok(html.indexOf('结果 · 1 行') < html.indexOf('证据局限'));
  assert.ok(html.indexOf('证据局限') < html.indexOf('分析结论'));
  assert.ok(html.indexOf('分析结论') < html.indexOf('后续计划'));
  assert.equal(html.split(quick.question).length - 1, 2);
  assert.doesNotMatch(html, /分析问题/);
  assert.doesNotMatch(html, /direct-report|direct-answer/);
  assert.match(html, /aria-label="00 加载数据"/);
  assert.match(html, /aria-label="第 0 步">00<\/span>/);
  assert.match(html, /aria-label="第 1 步">01<\/span>/);
  assert.match(html, /class="notebook-source"><details open="">/);
  assert.doesNotMatch(html, /已完成模型检查|重跑此单元格|编辑 SQL|<textarea/);
  assert.doesNotMatch(
    html.match(/<h2>快速分析<\/h2>(.*?)<\/div>/)?.[1] || '',
    /status-failed/,
  );
  for (const node of quick.nodes)
    assert.equal(html.split(`id="step-${node.id}"`).length - 1, 1, node.id);
  const summary = quick.nodes.find((node) => node.kind === 'summary');
  const detail = render(Detail, {
    node: summary,
    run: quick,
    onClose: noop,
    onChart: noop,
    onSelect: noop,
  });
  for (const label of [
    narrative.conclusion,
    narrative.limitations,
    narrative.nextStep,
    'Token 用量',
  ])
    assert.ok(detail.includes(label), label);
  assert.deepEqual(
    evidenceDatasets(quick, summary).map((dataset) => dataset.query.id),
    ['query-ok'],
  );
  const { default: App } = await server.ssrLoadModule('/src/app/App.tsx');
  const home = render(App, {});
  assert.match(home, /aria-label="分析模式"/);
  assert.match(home, /快速模式/);
  assert.match(home, /探索模式/);
  assert.doesNotMatch(home, /查询前暂停|逐步检查/);
});

test('loop notebook and evidence views include queryless steps, all query results and final verification', async () => {
  const { loopRun } = await import('../fixtures/loop-events.mjs');
  const loop = { ...loopRun(), source };
  const steps = notebookSteps(loop);
  assert.equal(steps.length, 4);
  assert.deepEqual(
    evidenceDatasets(loop, steps[0].node).map((dataset) => dataset.id),
    ['bad', 'sample'],
  );
  assert.deepEqual(
    evidenceDatasets(loop, steps[1].node).map((dataset) => dataset.id),
    ['sample'],
  );
  assert.deepEqual(
    evidenceDatasets(loop, loop.nodes.at(-1)).map((dataset) => dataset.id),
    ['total'],
  );
  const html = render(Notebook, { run: loop, onSelect: noop });
  assert.equal(html.split(loop.question).length - 1, 2);
  assert.doesNotMatch(html, /分析问题/);
  assert.doesNotMatch(html, /direct-report|direct-answer/);
  assert.match(html, /class="notebook-source"><details open="">/);
  for (const text of [
    '探索数据',
    '修正分析',
    '执行查询',
    '核验结论',
    '使用 sales 字段求和',
    '已检查两行数据',
    'Unknown column',
  ])
    assert.ok(html.includes(text), text);
  for (const node of loop.nodes)
    assert.equal(html.split(`id="step-${node.id}"`).length - 1, 1, node.id);
  const running = { ...loopRun({ running: true }), source };
  const runningHtml = render(Notebook, { run: running, onSelect: noop });
  assert.doesNotMatch(
    runningHtml.match(/<h2>探索数据<\/h2>(.*?)<\/div>/)?.[1] || '',
    /执行中/,
  );
  assert.match(runningHtml, /正在分析数据|查询执行中/);
  const unconfirmed = { ...loopRun({ confirmed: false }), source };
  const unconfirmedHtml = render(Notebook, {
    run: unconfirmed,
    onSelect: noop,
  });
  assert.match(unconfirmedHtml, /最终查询|本次未收到核验结论/);
  assert.doesNotMatch(unconfirmedHtml, /class="round-finding"/);
  const failed = { ...loopRun({ failed: true }), source };
  assert.match(
    render(Notebook, { run: failed, onSelect: noop }),
    /Model unavailable/,
  );
});

test('SQL steps show query cells once and retain the narrative when no query event exists', async () => {
  const { loopRun } = await import('../fixtures/loop-events.mjs');
  const loop = { ...loopRun(), source };
  const step = loop.nodes.find((node) => node.id === 'answer');
  const query = loop.nodes.find((node) => node.id === 'total');
  step.payload.text = `[SQL]\n\`\`\`sql\n${query.payload.sql}\n\`\`\``;
  const original = structuredClone(step.payload);
  const html = render(Notebook, { run: loop, onSelect: noop });
  const article = html.match(
    /<article[^>]*id="step-answer"[\s\S]*?<\/article>/,
  )[0];
  const text = article.replace(/<[^>]*>/g, '');
  assert.equal(text.split(query.payload.sql).length - 1, 1);
  assert.doesNotMatch(text, /分析过程|\[SQL\]/);
  assert.match(article, /结果 · 1 行|step-total:end/);
  assert.deepEqual(step.payload, original);

  const failed = {
    ...loop,
    nodes: loop.nodes.map((node) =>
      node.id === query.id
        ? {
            ...node,
            status: 'failed',
            payload: { ...node.payload, error: { message: 'Query failed' } },
          }
        : node,
    ),
  };
  assert.match(
    render(Notebook, { run: failed, onSelect: noop }),
    /Query failed/,
  );

  const withoutQuery = {
    ...loop,
    nodes: loop.nodes.filter(
      (node) => node.stepId !== step.id || node.id === step.id,
    ),
  };
  const fallback = notebookSteps(withoutQuery).find(
    (item) => item.node.id === step.id,
  );
  assert.equal(
    stepNarrative(withoutQuery, fallback).introduction,
    original.text,
  );
});

test('failed direct summaries leave SQL and results visible without a fabricated conclusion', async () => {
  const { directRun } = await import('../fixtures/direct-events.mjs');
  const quick = { ...directRun({ summaryError: true }), source };
  const html = render(Notebook, { run: quick, onSelect: noop });
  assert.match(html, /Invalid summary|SELECT SUM\(sales\)/);
  assert.match(html, /本次分析未生成查询说明/);
  assert.doesNotMatch(
    html,
    /class="round-finding"|class="direct-answer"|分析完成|等待模型核验/,
  );
  const summary = quick.nodes.find((node) => node.kind === 'summary');
  summary.payload.error = {
    name: 'AI_NoObjectGeneratedError',
    message: 'Could not parse',
    responseText: '',
    finishReason: 'length',
  };
  const detail = render(Detail, {
    node: summary,
    run: quick,
    onClose: noop,
    onChart: noop,
    onSelect: noop,
  });
  assert.match(detail, /模型返回（最多 3000 字符）/);
  assert.match(detail, /（空响应）/);
  assert.match(detail, /结束原因：length/);
});

test('stepId keeps sub-analyses separate and completed SQL stays folded', async () => {
  const { directRun } = await import('../fixtures/direct-events.mjs');
  const quick = directRun({ retry: false });
  const second = directRun({ retry: false });
  second.nodes = second.nodes.map((node) => ({
    ...node,
    id: `other-${node.id}`,
    stepId: 'step-b',
    parents: node.parents.map((id) => `other-${id}`),
  }));
  const steps = notebookSteps({
    ...quick,
    nodes: [...quick.nodes, ...second.nodes],
  });
  assert.equal(steps.length, 2);
  assert.ok(steps[0].nodes.every((node) => node.stepId === 'step-a'));
  assert.ok(steps[1].nodes.every((node) => node.stepId === 'step-b'));
  const html = render(Notebook, { run: { ...quick, source }, onSelect: noop });
  assert.match(html, /<details class="cell-input">/);
  const failed = {
    ...quick,
    status: 'failed',
    nodes: quick.nodes.map((node) =>
      node.kind === 'query' ? { ...node, status: 'failed' } : node,
    ),
    source,
  };
  assert.match(
    render(Notebook, { run: failed, onSelect: noop }),
    /<details class="cell-input" open="">/,
  );
});

test('direct layout retains long questions and pending steps without showing a premature answer', async () => {
  const { directRun } = await import('../fixtures/direct-events.mjs');
  const quick = { ...directRun({ retry: false }), source };
  const question = `${quick.question}请按地区分别核验，再说明统计口径。`;
  const html = render(Notebook, {
    run: { ...quick, question },
    onSelect: noop,
  });
  assert.ok(html.includes(`<p class="notebook-question">${question}</p>`));

  const pending = {
    ...quick,
    status: 'running',
    nodes: [{ ...quick.nodes[0], status: 'running' }],
  };
  const pendingHtml = render(Notebook, { run: pending, onSelect: noop });
  assert.match(pendingHtml, /正在生成查询/);
  assert.doesNotMatch(pendingHtml, /class="direct-answer"|销售总额为 10/);
});
