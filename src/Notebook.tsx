import { useState } from 'react';
import {
  ArrowUpRight,
  Play,
  Database,
  ScanSearch,
  Braces,
  Table2,
  CheckCircle2,
  LoaderCircle,
  CirclePause,
  GitBranch,
} from 'lucide-react';
import type { Evidence, Run } from './types';
import { statusLabels } from './types';
import { DataTable } from './Detail';
const icons: Record<string, typeof Database> = {
  source: Database,
  context: ScanSearch,
  reason: ScanSearch,
  query: Braces,
  result: Table2,
  conclusion: CheckCircle2,
  chart: Table2,
};
function Query({
  node,
  waiting,
  busy,
  execute,
}: {
  node: Evidence;
  waiting: boolean;
  busy: boolean;
  execute: (sql: string) => void;
}) {
  const [sql, setSQL] = useState(node.payload.sql || '');
  return (
    <>
      <div className="code-caption">
        <span>
          SQL <span className="muted">/ DuckDB</span>
        </span>
        {waiting && <span className="amber">可修改 · 执行前断点</span>}
      </div>
      {waiting ? (
        <textarea
          className="inline-editor mono"
          aria-label="编辑待执行的 SQL"
          spellCheck={false}
          value={sql}
          onChange={(e) => setSQL(e.target.value)}
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === 'Enter' &&
              sql.trim() &&
              !busy
            )
              execute(sql);
          }}
        />
      ) : (
        <pre className="inline-code">{node.payload.sql}</pre>
      )}
      {waiting && (
        <div className="inline-actions">
          <span>修改将被记录，并影响后续分析。</span>
          <button
            className="button primary"
            disabled={busy || !sql.trim()}
            onClick={() => execute(sql)}
          >
            <Play size={13} />
            {sql !== node.payload.sql ? '应用修改并运行' : '执行查询'}
          </button>
        </div>
      )}
    </>
  );
}
export default function Notebook({
  run,
  busy,
  selected,
  onSelect,
  onContinue,
  onFork,
}: {
  run: Run;
  busy: boolean;
  selected?: string;
  onSelect: (id: string) => void;
  onContinue: (sql?: string) => void;
  onFork: (id: string) => void;
}) {
  return (
    <div className="notebook-scroll">
      <div className="notebook-paper">
        <div className="notebook-intro">
          <span className="eyebrow">ANALYSIS RECORD</span>
          <h2>分析过程</h2>
          <p>每一步来自 AVA 的真实执行事件。选择步骤，查看输入与依据。</p>
        </div>
        {run.nodes.map((node, index) => {
          const Icon = icons[node.kind] || ScanSearch;
          const waiting =
            run.status === 'paused' && run.activeNodeId === node.id;
          return (
            <article
              key={node.id}
              id={`step-${node.id}`}
              className={`notebook-step ${
                selected === node.id ? 'focused' : ''
              } ${waiting ? 'waiting' : ''}`}
            >
              <div className="step-gutter">
                <span className="mono">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <i />
              </div>
              <div className="step-content">
                <div className="step-heading">
                  <button
                    className="step-name"
                    onClick={() => onSelect(node.id)}
                  >
                    <Icon size={16} />
                    <strong>{node.title}</strong>
                  </button>
                  <div className="step-tools">
                    <span className={`status status-${node.status}`}>
                      {node.status === 'running' ? (
                        <LoaderCircle size={12} className="spin" />
                      ) : waiting ? (
                        <CirclePause size={12} />
                      ) : null}
                      {statusLabels[node.status]}
                    </span>
                    <button
                      className="icon-button"
                      title="查看证据详情"
                      aria-label={`查看 ${node.title} 的证据详情`}
                      onClick={() => onSelect(node.id)}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                </div>
                {node.kind === 'source' && (
                  <div className="source-inline">
                    <Database size={25} />
                    <div>
                      <strong>
                        {node.payload.rows?.toLocaleString()} 行 ×{' '}
                        {node.payload.headers?.length} 列
                      </strong>
                      <p>
                        已保存 CSV 快照{' '}
                        <span className="mono">
                          {node.payload.hash?.slice(0, 10)}
                        </span>
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => onSelect(node.id)}
                    >
                      预览数据
                    </button>
                  </div>
                )}
                {node.kind === 'context' && (
                  <div className="context-chips">
                    {node.payload.schema?.models?.flatMap((m: any) =>
                      m.columns.map((c: any) => (
                        <span key={`${m.name}.${c.name}`}>
                          <b>{c.name}</b>
                          <small>{c.type}</small>
                        </span>
                      )),
                    )}
                    <button
                      className="text-button"
                      onClick={() => onSelect(node.id)}
                    >
                      查看统计 ↗
                    </button>
                  </div>
                )}
                {node.kind === 'reason' && (
                  <>
                    {node.payload.text ? (
                      <div className="prose notebook-prose">
                        {node.payload.text.replace(/^\[.*?\]\s*/, '')}
                      </div>
                    ) : (
                      <p className="muted">
                        {waiting
                          ? '等待继续本轮分析。'
                          : '正在结合数据与已有证据分析…'}
                      </p>
                    )}
                    {node.payload.finalAttempt && (
                      <div className="notice">
                        轮次上限后的最终尝试，结果仍需复核。
                      </div>
                    )}
                  </>
                )}
                {node.kind === 'query' && (
                  <Query
                    key={`${node.id}-${waiting}`}
                    node={node}
                    waiting={waiting}
                    busy={busy}
                    execute={(sql) => onContinue(sql)}
                  />
                )}
                {node.kind === 'result' && (
                  <>
                    {node.payload.truncated && (
                      <div className="notice">
                        返回结果已截断（{node.payload.truncatedBy}
                        ），不能视为全量明细。
                      </div>
                    )}
                    <DataTable
                      rows={node.payload.data || []}
                      columns={node.payload.schema?.map((c: any) => c.name)}
                    />
                  </>
                )}
                {node.kind === 'conclusion' && (
                  <>
                    <div
                      className={`verification ${
                        node.payload.completionReason === 'confirmed'
                          ? 'verified'
                          : ''
                      }`}
                    >
                      <CheckCircle2 size={14} />
                      {node.payload.completionReason === 'confirmed'
                        ? '模型已完成检查 · 请结合原始证据复核'
                        : '已执行 · 验证尚未完成'}
                    </div>
                    <div className="prose notebook-prose">
                      {node.payload.text}
                    </div>
                  </>
                )}
                {node.kind === 'chart' && (
                  <button
                    className="button secondary"
                    onClick={() => onSelect(node.id)}
                  >
                    查看图表与来源 <ArrowUpRight size={14} />
                  </button>
                )}
                {node.payload.error && (
                  <div className="notice error-notice">
                    {node.payload.error.message}
                  </div>
                )}
                <div className="step-bottom">
                  <span className="mono">
                    {node.id}
                    {node.duration !== undefined
                      ? ` · ${(node.duration / 1000).toFixed(2)}s`
                      : ''}
                  </span>
                  <div>
                    {node.parents.map((id) => (
                      <button
                        key={id}
                        title={`来源 ${id}`}
                        onClick={() => onSelect(id)}
                      >
                        ↳ {id}
                      </button>
                    ))}
                    {node.checkpoint &&
                      !['running', 'paused', 'pausing'].includes(
                        run.status,
                      ) && (
                        <button onClick={() => onFork(node.id)} disabled={busy}>
                          <GitBranch size={12} />
                          从此处重跑
                        </button>
                      )}
                  </div>
                </div>
                {waiting && node.kind !== 'query' && (
                  <div className="inline-actions">
                    <span>已到达执行检查点。</span>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => onContinue()}
                    >
                      <Play size={13} />
                      继续分析
                    </button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {['running', 'pausing'].includes(run.status) && (
          <div className="notebook-tail">
            <LoaderCircle size={15} className="spin" />
            <span>
              {run.status === 'pausing'
                ? '等待当前步骤完成后暂停…'
                : '分析仍在继续，新的证据将出现在这里。'}
            </span>
          </div>
        )}
        <div className="record-footer">
          AVA LOOP <span>·</span> CSV SNAPSHOT <span>·</span> {run.nodes.length}{' '}
          EVIDENCE NODES
        </div>
      </div>
    </div>
  );
}
