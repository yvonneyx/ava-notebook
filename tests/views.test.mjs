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
  Bars,
  notebookSteps,
  stepDatasets,
  stepNarrative;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  ({ evidenceDatasets, chartPreview, numericColumns } =
    await server.ssrLoadModule('/src/evidence-views.ts'));
  ({ default: EvidenceViews } = await server.ssrLoadModule(
    '/src/EvidenceViews.tsx',
  ));
  ({ default: Notebook } = await server.ssrLoadModule('/src/Notebook.tsx'));
  ({ default: Detail } = await server.ssrLoadModule('/src/Detail.tsx'));
  ({ Bars } = await server.ssrLoadModule('/src/DataViews.tsx'));
  ({ notebookSteps, stepDatasets, stepNarrative } = await server.ssrLoadModule(
    '/src/notebook-steps.ts',
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
  kind: 'reason',
  sequence: 1,
  title: '探索',
  parents: ['context'],
  status: 'succeeded',
  payload: {},
  step: 0,
};
const q0 = {
  id: 'q0',
  kind: 'query',
  sequence: 2,
  title: '查询 1',
  parents: ['m0'],
  status: 'succeeded',
  payload: { sql: 'SELECT 2 AS value', originalSQL: 'SELECT 1 AS value' },
  step: 0,
  checkpoint: 'q0',
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
  step: 1,
};
const conclusion = {
  id: 'end',
  kind: 'conclusion',
  sequence: 7,
  title: '结论',
  parents: ['m1'],
  status: 'completed',
  payload: { text: '**已验证**' },
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

test('three views follow exact query/result edges, including multiple queries and conclusion ancestors', () => {
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

test('pending, failed, empty, inherited and missing evidence do not acquire another query’s data', () => {
  const pending = { ...q0, id: 'pending', status: 'paused' };
  const branch = {
    ...run,
    nodes: [{ ...q0, inherited: true }, r0, pending, unrelated],
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
    evidenceDatasets(run, { kind: 'reason', id: 'unknown', parents: [] }),
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

test('every evidence kind exposes accessible tabs while retaining source, waiting and empty states', () => {
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
    assert.equal((html.match(/role="tab"/g) || []).length, 3);
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
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
    /无匹配结果/,
  );
  assert.match(
    render(EvidenceViews, { node: model0, run, onSelect: noop }),
    /选择关联查询/,
  );
  const chartHtml = render(EvidenceViews, { node: chart, run, onSelect: noop });
  assert.match(chartHtml, /图表数值列/);
  assert.match(chartHtml, /柱状图/);
});

test('SQL drafts stay editable and execution controls remain outside the view tabs', () => {
  const node = { ...q0, status: 'paused' };
  const paused = {
    ...run,
    status: 'paused',
    activeNodeId: 'q0',
    nodes: [node],
  };
  const draft = { sql: 'SELECT 8 AS value', instruction: '核对结果' };
  const common = {
    run: paused,
    busy: false,
    onEdit: noop,
    onContinue: noop,
    onFork: noop,
    onSelect: noop,
  };
  const html = render(Notebook, { ...common, drafts: { q0: draft } });
  assert.match(html, /SELECT 8 AS value/);
  assert.match(html, /应用并运行/);
  assert.ok(html.indexOf('应用并运行') < html.indexOf('class="cell-output"'));
  assert.match(html, /Shift\+Enter/);
  const detail = render(Detail, {
    ...common,
    node,
    draft,
    onClose: noop,
    onChart: noop,
  });
  assert.match(detail, /SELECT 8 AS value/);
  assert.match(detail, /核对结果/);
  assert.match(detail, /应用修改并继续/);
  assert.match(detail, /修改草稿 · 尚未执行/);
  assert.match(detail, /已记录的 SQL/);
  assert.match(detail, /SELECT 2 AS value/);
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

test('one loop round contains its own queries and results, with review-linked findings and stable node anchors', () => {
  const model = {
    ...model0,
    payload: {
      action: 'EXPLORE',
      text: '[EXPLORE]\n-- Purpose: 核对金额口径\n```sql\nSELECT 2\n```',
    },
  };
  const review = {
    ...model1,
    payload: {
      action: 'REFINE',
      text: '[REFINE]\nFindings:\n- 两条结果需要分别核对。\nPlan:\n- 检查贡献变化。\nNext: [SQL]',
    },
  };
  const fixture = { ...run, nodes: [model, q0, r0, q1, r1, review] };
  const steps = notebookSteps(fixture);
  assert.equal(steps.length, 2);
  assert.deepEqual(
    steps[0].nodes.map((n) => n.id),
    ['m0', 'q0', 'r0', 'q1', 'r1'],
  );
  assert.deepEqual(
    stepDatasets(fixture, steps[0]).map((d) => d.query.id),
    ['q0', 'q1'],
  );
  assert.ok(
    stepDatasets(fixture, steps[1]).every((d) =>
      d.label.startsWith('输入依据'),
    ),
  );
  const narrative = stepNarrative(fixture, steps[0]);
  assert.equal(narrative.introduction, '核对金额口径');
  assert.match(narrative.conclusion, /两条结果/);
  assert.equal(narrative.review.id, 'm1');
  assert.doesNotMatch(narrative.conclusion, /检查贡献变化/);
  const html = render(Notebook, {
    run: fixture,
    busy: false,
    drafts: {},
    onEdit: noop,
    onContinue: noop,
    onFork: noop,
    onSelect: noop,
  });
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.equal((html.match(/role="tab"/g) || []).length, 6);
  for (const id of ['m0', 'q0', 'r0', 'q1', 'r1', 'm1'])
    assert.equal(
      (html.match(new RegExp(`id="step-${id}"`, 'g')) || []).length,
      1,
    );
  assert.match(html, /本步结论/);
  assert.match(html, /后续核验/);
  const final = {
    ...conclusion,
    payload: {
      text: 'Verification:\n已核验。\nConclusion:\n贡献下降。',
      completionReason: 'confirmed',
    },
  };
  assert.equal(
    notebookSteps({ ...fixture, nodes: [...fixture.nodes, final] }).length,
    2,
  );
  const unfinished = stepNarrative(
    { ...fixture, nodes: [model, q0] },
    notebookSteps({ ...fixture, nodes: [model, q0] })[0],
  );
  assert.match(unfinished.conclusion, /等待查询执行/);
});

test('a grouped round edits the currently paused query without mixing in prior results', () => {
  const fixture = {
    ...run,
    status: 'paused',
    activeNodeId: 'q1',
    nodes: [model0, q0, r0, { ...q1, status: 'paused' }],
  };
  const html = render(Notebook, {
    run: fixture,
    busy: false,
    drafts: { q1: { sql: 'SELECT 99 AS value' } },
    onEdit: noop,
    onContinue: noop,
    onFork: noop,
    onSelect: noop,
  });
  assert.equal((html.match(/<article/g) || []).length, 1);
  assert.equal((html.match(/<textarea/g) || []).length, 1);
  assert.match(html, /SELECT 99 AS value/);
  assert.match(html, /应用并运行/);
  const step = notebookSteps(fixture)[0];
  assert.equal(stepDatasets(fixture, step)[1].rows, undefined);
});

test('notebook keeps every query input above its own output and does not repeat SQL in review rounds', () => {
  const html = render(Notebook, {
    run: { ...run, nodes: [model0, q0, r0, q1, r1, model1] },
    drafts: {},
    busy: false,
    onEdit: noop,
    onContinue: noop,
    onFork: noop,
    onSelect: noop,
  });
  assert.equal((html.match(/aria-label="SQL 单元格 /g) || []).length, 2);
  assert.equal((html.match(/<textarea/g) || []).length, 2);
  assert.equal((html.match(/SELECT 2 AS value/g) || []).length, 1);
  assert.equal((html.match(/SELECT 3 AS value/g) || []).length, 1);
  for (const [query, result, value] of [
    ['q0', 'r0', 2],
    ['q1', 'r1', 3],
  ]) {
    const cell = html.slice(
      html.indexOf(`id="step-${query}"`),
      html.indexOf(`id="step-${result}"`) + 1,
    );
    assert.match(cell, new RegExp(`SELECT ${value} AS value`));
  }
  assert.match(html, /查看本轮引用的 2 份依据/);
  assert.doesNotMatch(html, /role="tab"[^>]*>[^<]*SQL/);
});

test('only the paused query is editable in an active notebook; historical drafts label saved outputs', () => {
  const props = {
    drafts: { q0: { sql: 'SELECT 99 AS value' } },
    busy: false,
    onEdit: noop,
    onContinue: noop,
    onFork: noop,
    onSelect: noop,
  };
  const historical = render(Notebook, {
    ...props,
    run: { ...run, nodes: [model0, q0, r0] },
  });
  assert.match(historical, /SELECT 99 AS value/);
  assert.match(historical, /展示上次执行结果；SQL 修改后需重新执行/);
  assert.match(historical, /重跑会创建新分支，保留当前笔记/);
  const active = render(Notebook, {
    ...props,
    run: {
      ...run,
      status: 'paused',
      activeNodeId: 'q1',
      nodes: [model0, q0, r0, q1],
    },
  });
  assert.equal((active.match(/<textarea/g) || []).length, 1);
  assert.match(active, /aria-label="编辑 SQL 单元格 2"/);
  assert.doesNotMatch(active, /aria-label="编辑 SQL 单元格 1"/);
  assert.match(active, /运行后在下一条查询前暂停/);
});

test('completed SQL folds for reading while pending, failed and modified SQL stays open', () => {
  const notebook = (changes = {}, drafts = {}, query = q0) =>
    render(Notebook, {
      run: { ...run, nodes: [model0, query, r0], ...changes },
      drafts,
      busy: false,
      onEdit: noop,
      onContinue: noop,
      onFork: noop,
      onSelect: noop,
    });
  const completed = notebook();
  assert.match(completed, /<details class="cell-input">/);
  assert.match(completed, /结果 · 1 行/);
  assert.match(completed, /<td class="numeric">2<\/td>/);
  assert.doesNotMatch(completed, /等待模型核验|本轮尚未形成结论|In \[|Out \[/);
  for (const html of [
    notebook({ status: 'paused', activeNodeId: q0.id }),
    notebook({}, { q0: { sql: 'SELECT 99 AS value' } }),
    notebook(
      {},
      {},
      {
        ...q0,
        status: 'failed',
        payload: { ...q0.payload, error: { message: '查询失败' } },
      },
    ),
    notebook({ nodes: [model0, q0] }),
  ]) {
    assert.match(html, /<details class="cell-input" open="">/);
  }
});
