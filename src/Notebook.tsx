import {
  Route,
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
import EvidenceViews from './EvidenceViews';
import AnalysisText from './AnalysisText';
import { notebookSteps, stepDatasets, stepNarrative } from './notebook-steps';

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
        <span>
          {sql !== node.payload.sql
            ? '修改草稿 · 尚未执行'
            : waiting
            ? '执行前暂停'
            : 'DuckDB'}
        </span>
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
          <code>{sql}</code>
        </pre>
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
  const steps = notebookSteps(run);
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
          <h2>
            <Route size={14} /> 分析路径
          </h2>
          <span>{steps.length} 步</span>
        </div>
        {steps.map((step, index) => {
          const node = step.node;
          const pending =
            run.status === 'paused'
              ? step.nodes.find((item) => item.id === run.activeNodeId)
              : undefined;
          const running = step.nodes.find(
            (item) =>
              item.id === run.activeNodeId &&
              ['running', 'pausing'].includes(run.status),
          );
          const final = step.nodes.find((item) => item.kind === 'conclusion');
          const failed = step.nodes.find((item) => item.status === 'failed');
          const state = pending
            ? 'paused'
            : running
            ? 'running'
            : failed
            ? 'failed'
            : node.status;
          const Icon = final ? CheckCircle2 : icons[node.kind] || ScanSearch;
          const narrative = stepNarrative(run, step);
          const duration = step.nodes.reduce(
            (total, item) => total + (item.duration || 0),
            0,
          );
          const sql =
            pending?.kind === 'query'
              ? drafts[pending.id]?.sql ?? pending.payload.sql ?? ''
              : undefined;
          const modified =
            pending?.kind === 'query' && sql !== pending.payload.sql;
          return (
            <article
              key={node.id}
              id={`step-${node.id}`}
              className={`notebook-step kind-${
                final ? 'conclusion' : node.kind
              } ${
                step.nodes.some((item) => item.id === selected) ? 'focused' : ''
              } ${pending ? 'waiting' : ''}`}
            >
              {step.nodes
                .filter((item) => item.id !== node.id)
                .map((item) => (
                  <span
                    key={item.id}
                    id={`step-${item.id}`}
                    className="step-anchor"
                    aria-hidden="true"
                  />
                ))}
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
                    <span className="step-icon">
                      <Icon size={16} />
                    </span>
                    <strong>{node.title}</strong>
                  </button>
                  <div className="step-tools">
                    <span className={`status status-${state}`}>
                      {running ? (
                        <LoaderCircle size={12} className="spin" />
                      ) : pending ? (
                        <CirclePause size={12} />
                      ) : null}
                      {statusLabels[state] || state}
                    </span>
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
                <div className="loop-step-intro">
                  <AnalysisText text={narrative.introduction} />
                </div>
                {node.payload.finalAttempt && (
                  <div className="notice">轮次上限后的最终尝试 · 待验证</div>
                )}
                <EvidenceViews
                  node={node}
                  run={run}
                  datasets={stepDatasets(run, step)}
                  onSelect={onSelect}
                  sqlModified={(query) =>
                    !!query &&
                    drafts[query.id]?.sql !== undefined &&
                    drafts[query.id].sql !== query.payload.sql
                  }
                  sqlPane={(query) =>
                    query ? (
                      <Query
                        node={query}
                        waiting={pending?.id === query.id}
                        busy={busy}
                        sql={drafts[query.id]?.sql ?? query.payload.sql ?? ''}
                        onEdit={(value) => onEdit(query.id, { sql: value })}
                        execute={() =>
                          onContinue(drafts[query.id]?.sql ?? query.payload.sql)
                        }
                      />
                    ) : undefined
                  }
                />
                {step.nodes
                  .filter((item) => item.payload.error)
                  .map((item) => (
                    <div
                      key={item.id}
                      role="alert"
                      className="notice error-notice"
                    >
                      {item.payload.error.message || String(item.payload.error)}
                    </div>
                  ))}
                <div className="loop-step-conclusion">
                  <div className="loop-conclusion-heading">
                    <strong>{final ? '分析结论' : '本步结论'}</strong>
                    {narrative.review && (
                      <span>
                        后续核验 · 第 {(narrative.review.step ?? 0) + 1} 轮
                      </span>
                    )}
                    {final && (
                      <span>
                        {final.payload.completionReason === 'confirmed'
                          ? '已完成模型检查'
                          : '尚未验证'}
                      </span>
                    )}
                  </div>
                  <AnalysisText
                    text={narrative.conclusion || '等待模型核验。'}
                  />
                </div>
                {pending && (
                  <div className="inline-actions">
                    <span>等待执行 · {pending.title}</span>
                    <button
                      className="button primary"
                      disabled={
                        busy || (pending.kind === 'query' && !sql?.trim())
                      }
                      onClick={() => onContinue(sql)}
                    >
                      <Play size={13} />
                      {pending.kind === 'query'
                        ? modified
                          ? '应用并运行'
                          : '运行查询'
                        : '继续分析'}
                    </button>
                  </div>
                )}
                <div className="step-bottom">
                  <div>
                    {duration > 0 && (
                      <span className="step-duration">
                        <Clock3 size={11} />
                        {(duration / 1000).toFixed(2)} s
                      </span>
                    )}
                    {node.inherited && <span>来自原分支</span>}
                    <span>
                      {
                        step.nodes.filter((item) => item.kind === 'query')
                          .length
                      }{' '}
                      条查询
                    </span>
                  </div>
                  <div>
                    <button onClick={() => onSelect(node.id)}>
                      <Layers2 size={12} />
                      证据详情
                    </button>
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
                          重跑本步
                        </button>
                      )}
                  </div>
                </div>
              </div>
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
