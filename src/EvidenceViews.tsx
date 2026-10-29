import { useId, useState } from 'react';
import { Braces, Table2, ChartColumn, ArrowUpRight } from 'lucide-react';
import type { Evidence, Run } from './types';
import StatusIcon from './StatusIcon';
import { DataTable, Bars } from './DataViews';
import SqlCode from './SqlCode';
import {
  evidenceDatasets,
  numericColumns,
  chartPreview,
} from './evidence-views';
import type { EvidenceDataset } from './evidence-views';

type View = 'sql' | 'data' | 'chart';
const views = [
  { id: 'sql', label: 'SQL', Icon: Braces },
  { id: 'data', label: 'Data', Icon: Table2 },
  { id: 'chart', label: 'Chart', Icon: ChartColumn },
] as const;

type Axes = { x?: string; y?: string };
function ChartPreview({
  dataset,
  node,
  axes,
  onAxes,
  busy,
  onChart,
}: {
  dataset: EvidenceDataset;
  node: Evidence;
  axes: Axes;
  onAxes: (axes: Axes) => void;
  busy?: boolean;
  onChart?: (nodeId: string, x: string, y: string) => void;
}) {
  const numeric = numericColumns(dataset);
  const preferredX =
    axes.x ?? (node.kind === 'chart' ? node.payload.x : undefined);
  const preferredY =
    axes.y ?? (node.kind === 'chart' ? node.payload.y : undefined);
  const x =
    preferredX === '' || dataset.columns.includes(preferredX)
      ? preferredX
      : dataset.columns.find((name) => !numeric.includes(name)) || '';
  const y = numeric.includes(preferredY) ? preferredY : numeric[0] || '';
  const chart = chartPreview(dataset, x, y);
  if (!dataset.rows?.length)
    return <p className="view-empty">没有结果行可供绘图</p>;
  if (!numeric.length)
    return <p className="view-empty">这份数据没有数值列，可切换到 Data 查看</p>;
  return (
    <>
      <div className="chart-controls">
        <label>
          分类
          <select
            aria-label="图表分类列"
            value={x}
            onChange={(event) => onAxes({ x: event.target.value, y })}
          >
            <option value="">行号</option>
            {dataset.columns.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          数值
          <select
            aria-label="图表数值列"
            value={y}
            onChange={(event) => onAxes({ x, y: event.target.value })}
          >
            {numeric.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>
      {chart.rows.length ? (
        <Bars title={`${y} · ${x || '行号'}`} rows={chart.rows} />
      ) : (
        <p className="view-empty">前 20 行没有可绘制的有效数值</p>
      )}
      <div className="chart-preview-footer">
        <span>
          {chart.limited
            ? '仅展示前 20 行内的有效数据'
            : `${chart.rows.length} 行 · 不聚合`}
          {chart.omitted > 0 && ` · 跳过 ${chart.omitted} 个空值或非数值`}
        </span>
        {onChart && dataset.result && (
          <button
            className="text-button"
            disabled={busy || !chart.canSave}
            title={
              !chart.canSave
                ? '保存需要分类列，且前 20 行的数值均有效'
                : '将此图表保存为证据节点'
            }
            onClick={() => onChart(dataset.result!.id, x, y)}
          >
            <ChartColumn size={12} /> 保存图表
          </button>
        )}
      </div>
    </>
  );
}

export default function EvidenceViews({
  node,
  run,
  datasets: scopedDatasets,
  onSelect,
  busy,
  onChart,
  outputOnly = false,
  caption,
}: {
  node: Evidence;
  run: Run;
  datasets?: EvidenceDataset[];
  onSelect: (id: string) => void;
  busy?: boolean;
  onChart?: (nodeId: string, x: string, y: string) => void;
  outputOnly?: boolean;
  caption?: string;
}) {
  const scope = useId();
  const availableViews = outputOnly
    ? views.filter((item) => item.id !== 'sql')
    : views;
  const [view, setView] = useState<View>(
    node.kind === 'chart'
      ? 'chart'
      : !outputOnly && ['query', 'translate'].includes(node.kind)
      ? 'sql'
      : 'data',
  );
  const [datasetId, setDatasetId] = useState('');
  const [axes, setAxes] = useState<Record<string, Axes>>({});
  const datasets = scopedDatasets ?? evidenceDatasets(run, node);
  const dataset = datasets.find((item) => item.id === datasetId) || datasets[0];
  const query = dataset?.query;
  const pending = query
    ? query.status === 'failed'
      ? '查询失败，尚无结果数据'
      : '这条查询尚无结果，执行完成后可查看'
    : '该环节暂无关联的查询数据';
  return (
    <section
      className="evidence-views"
      aria-label={`${node.title}的${outputOnly ? '输出' : '三种视图'}`}
    >
      <div className="evidence-view-toolbar">
        {caption && <span className="evidence-caption">{caption}</span>}
        <div
          className="evidence-tabs"
          role="tablist"
          aria-label="证据视图"
          onKeyDown={(event) => {
            const index = availableViews.findIndex((item) => item.id === view);
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % availableViews.length
                : event.key === 'ArrowLeft'
                ? (index + availableViews.length - 1) % availableViews.length
                : event.key === 'Home'
                ? 0
                : event.key === 'End'
                ? availableViews.length - 1
                : -1;
            if (next < 0) return;
            event.preventDefault();
            setView(availableViews[next].id);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          }}
        >
          {availableViews.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`${scope}-${id}`}
              type="button"
              role="tab"
              aria-selected={view === id}
              aria-controls={`${scope}-panel`}
              tabIndex={view === id ? 0 : -1}
              onClick={() => setView(id)}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        {datasets.length > 1 && (
          <select
            className="evidence-dataset-picker"
            aria-label="选择关联查询"
            value={dataset?.id || ''}
            onChange={(event) => setDatasetId(event.target.value)}
          >
            {datasets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div
        id={`${scope}-panel`}
        role="tabpanel"
        aria-labelledby={`${scope}-${view}`}
        tabIndex={0}
        className="evidence-view-panel"
      >
        {view === 'sql' ? (
          <>
            {query ? (
              <>
                <div className="code-caption">
                  <span className="code-language">SQL</span>
                  <StatusIcon status={query.status} />
                </div>
                <pre className="inline-code">
                  <SqlCode sql={query.payload.sql} />
                </pre>
                {query.id !== node.id && (
                  <button
                    className="text-button view-query-link"
                    onClick={() => onSelect(query.id)}
                  >
                    打开查询步骤 <ArrowUpRight size={12} />
                  </button>
                )}
              </>
            ) : (
              <p className="view-empty">该环节没有执行 SQL</p>
            )}
          </>
        ) : (
          <>
            {dataset?.preview && (
              <p className="view-data-note">
                CSV 预览 · {dataset.rows?.length || 0} /{' '}
                {dataset.total?.toLocaleString()} 行
              </p>
            )}
            {dataset?.truncated && (
              <div className="notice">结果已截断，仅展示已保存的数据。</div>
            )}
            {view === 'chart' && node.kind === 'chart' && !dataset ? (
              <>
                <p className="view-data-note">
                  已保存图表 · 源结果不可用
                  {node.payload.truncated ? ' · 仅部分结果' : ''}
                </p>
                <Bars title={node.title} rows={node.payload.rows || []} />
              </>
            ) : !dataset?.rows ? (
              <p className="view-empty">{pending}</p>
            ) : view === 'data' ? (
              <DataTable
                key={dataset.id}
                rows={dataset.rows}
                columns={dataset.columns}
              />
            ) : (
              <ChartPreview
                key={dataset.id}
                dataset={dataset}
                node={node}
                axes={axes[dataset.id] || {}}
                onAxes={(next) =>
                  setAxes((current) => ({ ...current, [dataset.id]: next }))
                }
                busy={busy}
                onChart={onChart}
              />
            )}
            {query && query.id !== node.id && (
              <button
                className="text-button view-query-link"
                onClick={() => onSelect(query.id)}
              >
                来源：{dataset.label} <ArrowUpRight size={12} />
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
