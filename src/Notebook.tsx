import {
  ArrowUpRight,
  Play,
  Database,
  ScanSearch,
  Braces,
  Table2,
  CheckCircle2,
  LoaderCircle,
  GitBranch,
  ChevronRight,
  Clock3,
  Layers2,
  FileSpreadsheet,
  CirclePause,
} from 'lucide-react';
import type { Evidence, Run } from './types';
import { statusLabels } from './types';
import { Bars, DataTable } from './Detail';
import AnalysisText from './AnalysisText';

const icons: Record<string, typeof Database> = {
  source: Database,
  context: ScanSearch,
  reason: ScanSearch,
  query: Braces,
  result: Table2,
  conclusion: CheckCircle2,
  chart: Table2,
};
type Draft = { sql?: string; instruction?: string };

function Query({
  node,
  waiting,
  busy,
  sql,
  onEdit,
  execute,
}: {
  node: Evidence;
  waiting: boolean;
  busy: boolean;
  sql: string;
  onEdit: (sql: string) => void;
  execute: () => void;
}) {
  return (
    <>
      <div className="code-caption">
        <span className="code-language">SQL</span>
        <span>{waiting ? '执行前暂停' : 'DuckDB'}</span>
      </div>
      {waiting ? (
        <textarea
          className="inline-editor mono"
          aria-label="编辑待执行的 SQL"
          spellCheck={false}
          value={sql}
          onChange={(e) => onEdit(e.target.value)}
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === 'Enter' &&
              sql.trim() &&
              !busy
            )
              execute();
          }}
        />
      ) : (
        <pre className="inline-code">
          <code>{node.payload.sql}</code>
        </pre>
      )}
      {waiting && (
        <div className="inline-actions">
          <span>
            <CirclePause size={13} />
            等待运行
          </span>
          <button
            className="button primary"
            disabled={busy || !sql.trim()}
            onClick={execute}
          >
            <Play size={13} />
            {sql !== node.payload.sql ? '应用并运行' : '运行查询'}
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
  drafts,
  onEdit,
  onSelect,
  onContinue,
  onFork,
}: {
  run: Run;
  busy: boolean;
  selected?: string;
  drafts: Record<string, Draft>;
  onEdit: (id: string, value: Draft) => void;
  onSelect: (id: string) => void;
  onContinue: (sql?: string) => void;
  onFork: (id: string) => void;
}) {
  return (
    <div className="notebook-scroll">
      <div className="notebook-paper">
        <div className="notebook-data">
          {run.nodes
            .filter((n) => n.kind === 'source' || n.kind === 'context')
            .map((node) => (
              <button
                id={`step-${node.id}`}
                key={node.id}
                className={`data-step ${
                  selected === node.id ? 'selected' : ''
                }`}
                onClick={() => onSelect(node.id)}
              >
                <span className="data-step-icon">
                  {node.kind === 'source' ? (
                    <FileSpreadsheet size={19} />
                  ) : (
                    <Layers2 size={17} />
                  )}
                </span>
                <span>
                  <strong>
                    {node.kind === 'source' ? node.title : '字段与数据质量'}
                  </strong>
                  <small>
                    {node.kind === 'source'
                      ? `${node.payload.rows?.toLocaleString()} 行 · ${
                          node.payload.headers?.length
                        } 个字段`
                      : run.source.headers.slice(0, 4).join(' · ') +
                        (run.source.headers.length > 4 ? ' …' : '')}
                  </small>
                </span>
                <span className="data-step-action">
                  {node.kind === 'source' ? '预览' : '查看'}
                  <ChevronRight size={14} />
                </span>
              </button>
            ))}
        </div>
        <div className="process-heading">
          <h2>分析过程</h2>
          <span>{run.nodes.filter((n) => n.kind === 'reason').length} 轮</span>
        </div>
        {run.nodes
          .filter((n) => n.kind !== 'source' && n.kind !== 'context')
          .map((node) => {
            const Icon = icons[node.kind] || ScanSearch;
            const waiting =
              run.status === 'paused' && run.activeNodeId === node.id;
            const status = (
              <span className={`status status-${node.status}`}>
                {node.status === 'running' ? (
                  <LoaderCircle size={12} className="spin" />
                ) : waiting ? (
                  <CirclePause size={12} />
                ) : null}
                {statusLabels[node.status]}
              </span>
            );
            const content = (
              <>
                {node.kind === 'reason' &&
                  (node.payload.text ? (
                    <AnalysisText
                      text={node.payload.text.replace(/^\[.*?\]\s*/, '')}
                    />
                  ) : (
                    <p className="pending-text">
                      {waiting ? '准备继续分析' : '正在分析数据…'}
                    </p>
                  ))}
                {node.payload.finalAttempt && (
                  <div className="notice">轮次上限后的最终尝试 · 待验证</div>
                )}
                {node.kind === 'query' && (
                  <Query
                    node={node}
                    waiting={waiting}
                    busy={busy}
                    sql={drafts[node.id]?.sql ?? node.payload.sql ?? ''}
                    onEdit={(sql) => onEdit(node.id, { sql })}
                    execute={() =>
                      onContinue(drafts[node.id]?.sql ?? node.payload.sql)
                    }
                  />
                )}
                {node.kind === 'result' && (
                  <>
                    {node.payload.truncated && (
                      <div className="notice">
                        已达返回上限 · 仅显示部分结果
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
                        ? '已完成模型检查'
                        : '执行完成 · 尚未验证'}
                    </div>
                    <AnalysisText text={node.payload.text || ''} />
                  </>
                )}
                {node.kind === 'chart' && (
                  <>
                    {node.payload.truncated && (
                      <div className="notice">仅显示部分结果</div>
                    )}
                    <Bars node={node} />
                  </>
                )}
                {node.payload.error && (
                  <div role="alert" className="notice error-notice">
                    {node.payload.error.message}
                  </div>
                )}
                {waiting && node.kind !== 'query' && (
                  <div className="inline-actions">
                    <span>等待执行</span>
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
                <div className="step-bottom">
                  <div>
                    {node.duration !== undefined && (
                      <span className="step-duration">
                        <Clock3 size={11} />
                        {(node.duration / 1000).toFixed(2)} s
                      </span>
                    )}
                    {node.inherited && <span>来自原分支</span>}
                  </div>
                  <div>
                    {node.parents.length > 0 && (
                      <button onClick={() => onSelect(node.id)}>
                        <Layers2 size={12} />
                        {node.parents.length} 条依据
                      </button>
                    )}
                    {node.checkpoint &&
                      !['running', 'paused', 'pausing'].includes(
                        run.status,
                      ) && (
                        <button
                          className="rerun-action"
                          onClick={() => onFork(node.id)}
                          disabled={busy}
                        >
                          <GitBranch size={12} />
                          重跑
                        </button>
                      )}
                  </div>
                </div>
              </>
            );
            return (
              <article
                key={node.id}
                id={`step-${node.id}`}
                className={`notebook-step kind-${node.kind} ${
                  selected === node.id ? 'focused' : ''
                } ${waiting ? 'waiting' : ''}`}
              >
                <div className="step-gutter">
                  <span className="mono">
                    {String(node.sequence + 1).padStart(2, '0')}
                  </span>
                  <i />
                </div>
                {node.kind === 'reason' ? (
                  <details
                    className="step-content reason-step"
                    open={waiting || node.status === 'running'}
                  >
                    <summary>
                      <Icon size={15} />
                      <strong>{node.title}</strong>
                      {status}
                      <ChevronRight size={14} className="disclosure-chevron" />
                    </summary>
                    <div className="reason-content">{content}</div>
                  </details>
                ) : (
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
                        {status}
                        <button
                          className="icon-button"
                          title="查看详情"
                          aria-label={`查看 ${node.title} 的证据详情`}
                          onClick={() => onSelect(node.id)}
                        >
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                    </div>
                    {content}
                  </div>
                )}
              </article>
            );
          })}
        {['running', 'pausing'].includes(run.status) && (
          <div className="notebook-tail">
            <LoaderCircle size={14} className="spin" />
            <span>
              {run.status === 'pausing' ? '完成当前步骤后暂停…' : '分析中…'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
