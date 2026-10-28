import { useEffect, useState } from 'react';
import AnalysisText from './AnalysisText';
import {
  X,
  GitBranch,
  Play,
  Copy,
  Check,
  ChartColumn,
  ChevronDown,
  FileCode2,
} from 'lucide-react';
import { kindLabels, statusLabels, isActive } from './types';
import type { Evidence, Run, Mode } from './types';
export function DataTable({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns?: string[];
}) {
  const [page, setPage] = useState(0);
  const names = columns || Object.keys(rows[0] || {});
  const numeric = new Set(
    names.filter((name) => rows.some((row) => typeof row[name] === 'number')),
  );
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {names.map((name) => (
                <th
                  key={name}
                  className={numeric.has(name) ? 'numeric' : undefined}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={names.length || 1} className="table-empty">
                  无匹配结果
                </td>
              </tr>
            )}
            {rows.slice(page * 20, page * 20 + 20).map((row, index) => (
              <tr key={index}>
                {names.map((name) => (
                  <td
                    key={name}
                    className={numeric.has(name) ? 'numeric' : undefined}
                  >
                    {row[name] === null ? (
                      <span className="muted">null</span>
                    ) : (
                      String(row[name] ?? '')
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 20 && (
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>
            {page + 1} / {Math.ceil(rows.length / 20)}
          </span>
          <button
            disabled={(page + 1) * 20 >= rows.length}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}
export function Bars({ node }: { node: Evidence }) {
  const rows = node.payload.rows as { label: string; value: number }[];
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div
      className="bars"
      role="img"
      aria-label={`${node.title}柱状图，${rows
        .map((row) => `${row.label}：${row.value}`)
        .join('；')}`}
    >
      {rows.map((row, i) => (
        <div className="bar-row" key={i}>
          <span title={row.label}>{row.label}</span>
          <div className="bar-track">
            <i
              className={row.value < 0 ? 'negative' : ''}
              style={{
                width: `${Math.max((Math.abs(row.value) / max) * 100, 1)}%`,
              }}
            />
          </div>
          <b>{row.value.toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}
export default function Detail({
  node,
  draft,
  onEdit,
  run,
  busy,
  onClose,
  onContinue,
  onFork,
  onChart,
  onSelect,
}: {
  node: Evidence;
  draft: { sql?: string; instruction?: string };
  onEdit: (value: { sql?: string; instruction?: string }) => void;
  run: Run;
  busy: boolean;
  onClose: () => void;
  onContinue: (
    decision: { sql?: string; instruction?: string },
    mode?: Mode,
  ) => void;
  onFork: (
    nodeId: string,
    decision: { sql?: string; instruction?: string },
  ) => void;
  onChart: (nodeId: string, x: string, y: string) => void;
  onSelect: (id: string) => void;
}) {
  const sql = draft.sql ?? node.payload.sql ?? '';
  const instruction = draft.instruction ?? '';
  const [copied, setCopied] = useState(false);
  const [chartX, setChartX] = useState('');
  const [chartY, setChartY] = useState('');
  useEffect(() => {
    const columns = node.payload.schema || [];
    setChartX(columns[0]?.name || '');
    setChartY(
      columns.find(
        (c: any) => typeof node.payload.data?.[0]?.[c.name] === 'number',
      )?.name || '',
    );
  }, [node.id]);
  const waiting = run.status === 'paused' && run.activeNodeId === node.id;
  const canEdit = waiting || (!isActive(run) && !!node.checkpoint);
  const decision = {
    ...(node.kind === 'query' && sql !== node.payload.sql ? { sql } : {}),
    ...(instruction.trim() ? { instruction } : {}),
  };
  return (
    <aside
      className="detail"
      aria-label="节点详情"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="detail-header">
        <span>{kindLabels[node.kind]}</span>
        <button
          className="icon-button"
          aria-label="关闭节点详情"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="detail-body">
        <div className="detail-title">
          <h2>{node.title}</h2>
          <span className={`status status-${node.status}`}>
            {statusLabels[node.status] || node.status}
          </span>
        </div>
        <div className="detail-meta">
          <span>步骤 {String(node.sequence + 1).padStart(2, '0')}</span>
          {node.duration !== undefined && (
            <span>{(node.duration / 1000).toFixed(2)} 秒</span>
          )}
          {node.inherited && <span>继承自原分支</span>}
        </div>
        {waiting && <div className="notice pause-notice">等待执行</div>}
        {node.payload.error && (
          <div role="alert" className="notice error-notice">
            {node.payload.error.message}
          </div>
        )}
        {node.kind === 'source' && (
          <>
            <div className="stat-grid">
              <div>
                <b>{node.payload.rows?.toLocaleString()}</b>
                <span>数据行</span>
              </div>
              <div>
                <b>{node.payload.headers?.length}</b>
                <span>字段</span>
              </div>
              <div>
                <b>{(node.payload.bytes / 1024).toFixed(1)} KB</b>
                <span>快照大小</span>
              </div>
            </div>
            <h3>数据预览</h3>
            <DataTable rows={node.payload.preview || []} />
            <details>
              <summary>数据指纹</summary>
              <p className="fingerprint mono">{node.payload.hash}</p>
            </details>
          </>
        )}
        {node.kind === 'context' && (
          <>
            {node.payload.schema?.models?.map((model: any) => (
              <div key={model.name}>
                <h3>{model.name}</h3>
                <DataTable
                  rows={model.columns.map((c: any) => ({
                    字段: c.name,
                    类型: c.type,
                  }))}
                />
              </div>
            ))}
            <details>
              <summary>查看数据质量统计</summary>
              <pre>{JSON.stringify(node.payload.profile, null, 2)}</pre>
            </details>
          </>
        )}
        {node.kind === 'reason' && (
          <>
            {node.payload.text && (
              <AnalysisText
                text={node.payload.text.replace(/^\[.*?\]\s*/, '')}
              />
            )}
            {node.payload.finalAttempt && (
              <div className="notice">已达到轮次上限，本轮为最终尝试。</div>
            )}
            {node.payload.prompt && (
              <details>
                <summary>
                  <FileCode2 size={14} /> 模型输入
                </summary>
                <pre>{node.payload.prompt}</pre>
              </details>
            )}
            {node.payload.usage && (
              <details>
                <summary>Token 用量</summary>
                <pre>{JSON.stringify(node.payload.usage, null, 2)}</pre>
              </details>
            )}
          </>
        )}
        {node.kind === 'query' && (
          <>
            <div className="section-label">
              <h3>
                {waiting || node.status === 'ready'
                  ? '待执行 SQL'
                  : '实际执行 SQL'}
              </h3>
              <button
                className="icon-button"
                aria-label="复制 SQL"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sql);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <textarea
              className="code-editor mono"
              aria-label="SQL 编辑器"
              value={sql}
              onChange={(e) => onEdit({ sql: e.target.value })}
              readOnly={!canEdit}
              spellCheck={false}
            />
            {node.payload.originalSQL && (
              <details>
                <summary>原始 SQL</summary>
                <pre>{node.payload.originalSQL}</pre>
              </details>
            )}
          </>
        )}
        {node.kind === 'result' && (
          <>
            {node.payload.truncated && (
              <div className="notice">
                结果已截断：
                {node.payload.truncatedBy === 'maxRows'
                  ? '达到行数限制'
                  : '达到字节限制'}
                。仅显示部分结果。
              </div>
            )}
            <DataTable
              rows={node.payload.data || []}
              columns={node.payload.schema?.map((c: any) => c.name)}
            />
            <details className="chart-options">
              <summary>
                <ChartColumn size={14} />
                生成图表
              </summary>
              <div className="chart-controls">
                <label>
                  分类
                  <select
                    value={chartX}
                    onChange={(e) => setChartX(e.target.value)}
                  >
                    {node.payload.schema?.map((c: any) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  数值
                  <select
                    value={chartY}
                    onChange={(e) => setChartY(e.target.value)}
                  >
                    <option value="">选择数值列</option>
                    {node.payload.schema
                      ?.filter(
                        (c: any) =>
                          typeof node.payload.data?.[0]?.[c.name] === 'number',
                      )
                      .map((c: any) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                  </select>
                </label>
              </div>
              <button
                className="button secondary full"
                disabled={busy || !chartY}
                onClick={() => onChart(node.id, chartX, chartY)}
              >
                <ChartColumn size={15} />
                生成柱状图
              </button>
              <p className="hint">使用前 20 行结果</p>
            </details>
          </>
        )}
        {node.kind === 'conclusion' && (
          <>
            <div
              className={`notice ${
                node.payload.completionReason === 'confirmed'
                  ? 'success-notice'
                  : ''
              }`}
            >
              {node.payload.completionReason === 'confirmed'
                ? '已完成模型检查'
                : '执行完成 · 尚未验证'}
            </div>
            <AnalysisText text={node.payload.text || '等待分析完成'} />
          </>
        )}
        {node.kind === 'chart' && (
          <>
            {node.payload.truncated && (
              <div className="notice">
                此图仅展示部分结果，请结合原始查询判断。
              </div>
            )}
            <Bars node={node} />
          </>
        )}
        {node.parents.length > 0 && (
          <div className="evidence-links">
            <h3>输入与来源</h3>
            {node.parents.map((id) => (
              <button key={id} onClick={() => onSelect(id)}>
                <GitBranch size={13} />
                <span>{run.nodes.find((n) => n.id === id)?.title || id}</span>
                <span className="mono">↗</span>
              </button>
            ))}
          </div>
        )}
        {node.payload.interventions?.length > 0 && (
          <details>
            <summary>人工介入记录</summary>
            <pre>{JSON.stringify(node.payload.interventions, null, 2)}</pre>
          </details>
        )}
        {canEdit && node.checkpoint && node.kind !== 'conclusion' && (
          <label className="field">
            补充要求
            <textarea
              value={instruction}
              onChange={(e) => onEdit({ instruction: e.target.value })}
              placeholder="例如：只分析线上渠道，并核对异常值。"
              maxLength={8000}
            />
          </label>
        )}
      </div>
      {node.checkpoint && (
        <div className="detail-footer">
          {waiting ? (
            <>
              <button
                className="button primary full"
                disabled={busy || (node.kind === 'query' && !sql.trim())}
                onClick={() => onContinue(decision)}
              >
                <Play size={14} />
                {Object.keys(decision).length ? '应用修改并继续' : '继续执行'}
              </button>
              <button
                className="button secondary full"
                disabled={busy || (node.kind === 'query' && !sql.trim())}
                onClick={() => onContinue(decision, 'step')}
              >
                执行单步 <ChevronDown size={14} />
              </button>
            </>
          ) : (
            <button
              className="button secondary full"
              disabled={
                busy || isActive(run) || (node.kind === 'query' && !sql.trim())
              }
              onClick={() => onFork(node.id, decision)}
            >
              <GitBranch size={15} />
              新建分支并重跑
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
