import { useEffect, useRef } from 'react';
import {
  ArrowUpRight,
  Play,
  LoaderCircle,
  GitBranch,
  FileSpreadsheet,
  CirclePause,
  RotateCcw,
} from 'lucide-react';
import type { Evidence, Mode, Run } from './types';
import { isActive, statusLabels } from './types';
import EvidenceViews from './EvidenceViews';
import AnalysisText from './AnalysisText';
import { DataTable } from './DataViews';
import { notebookSteps, stepDatasets, stepNarrative } from './notebook-steps';
import { evidenceDatasets } from './evidence-views';
import { browserMode } from './api';

type Draft = { sql?: string; instruction?: string };
type NotebookProps = {
  run: Run;
  busy: boolean;
  selected?: string;
  drafts: Record<string, Draft>;
  onEdit: (id: string, value: Draft) => void;
  onSelect: (id: string) => void;
  onContinue: (decision: Draft, mode: Mode) => void;
  onFork: (id: string) => void;
};

function QueryCell({
  node,
  number,
  run,
  busy,
  draft,
  selected,
  onEdit,
  onSelect,
  onContinue,
  onFork,
}: Omit<NotebookProps, 'drafts'> & {
  node: Evidence;
  number: number;
  draft: Draft;
}) {
  const waiting = run.status === 'paused' && run.activeNodeId === node.id;
  const running =
    run.activeNodeId === node.id && ['running', 'pausing'].includes(run.status);
  const editable = waiting || (!isActive(run) && !!node.checkpoint);
  const sql = draft.sql ?? node.payload.sql ?? '';
  const modified = sql !== node.payload.sql;
  const dataset = evidenceDatasets(run, node)[0];
  const execute = () => {
    if (browserMode || busy || !editable || !sql.trim()) return;
    if (waiting) onContinue({ sql }, 'query');
    else onFork(node.id);
  };
  return (
    <section
      id={`step-${node.id}`}
      aria-label={`SQL 单元格 ${number}`}
      className={`query-cell ${waiting ? 'waiting' : ''} ${
        selected === node.id ? 'inspected' : ''
      }`}
    >
      <details
        className="cell-input"
        open={
          waiting ||
          running ||
          modified ||
          node.status === 'failed' ||
          !dataset?.rows ||
          undefined
        }
      >
        <summary
          className="cell-toolbar"
          aria-label={`查看或编辑查询 ${number} 的 SQL`}
        >
          <span>
            查询 {number} <span className="cell-language">SQL</span>
          </span>
          <div>
            {modified && <span className="draft-indicator">未运行的修改</span>}
            {!['succeeded', 'completed'].includes(node.status) && (
              <span
                className={`status status-${waiting ? 'paused' : node.status}`}
              >
                {running && <LoaderCircle size={12} className="spin" />}
                {waiting
                  ? '等待运行'
                  : statusLabels[node.status] || node.status}
              </span>
            )}
            <button
              className="icon-button"
              aria-label={`查看查询 ${number} 的详情`}
              onClick={(event) => {
                event.preventDefault();
                onSelect(node.id);
              }}
            >
              <ArrowUpRight size={14} />
            </button>
          </div>
        </summary>
        <div className="cell-editor-wrap">
          {editable ? (
            <textarea
              className="cell-editor mono"
              aria-label={`编辑 SQL 单元格 ${number}`}
              aria-keyshortcuts="Shift+Enter Meta+Enter Control+Enter"
              spellCheck={false}
              rows={Math.min(20, Math.max(3, sql.split('\n').length))}
              value={sql}
              onChange={(event) => onEdit(node.id, { sql: event.target.value })}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  (event.shiftKey || event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  execute();
                }
              }}
            />
          ) : (
            <pre className="cell-editor mono">
              <code>{sql}</code>
            </pre>
          )}
          {editable && (
            <div className="cell-editor-footer">
              <span>
                {waiting
                  ? '运行后在下一条查询前暂停'
                  : '重跑会创建新分支，保留当前笔记'}
              </span>
              <div>
                {modified && (
                  <button
                    className="text-button"
                    onClick={() => onEdit(node.id, { sql: node.payload.sql })}
                  >
                    <RotateCcw size={12} />
                    还原
                  </button>
                )}
                <button
                  className={`button small ${
                    waiting ? 'primary' : 'secondary'
                  }`}
                  disabled={browserMode || busy || !sql.trim()}
                  onClick={execute}
                >
                  {waiting ? <Play size={12} /> : <GitBranch size={12} />}
                  {waiting
                    ? modified
                      ? '应用并运行'
                      : '运行查询'
                    : '重跑此单元格'}
                </button>
              </div>
            </div>
          )}
        </div>
      </details>
      <div
        className="cell-output"
        id={dataset?.result ? `step-${dataset.result.id}` : undefined}
      >
        <div className="cell-output-body">
          {node.payload.error && (
            <div role="alert" className="notice error-notice">
              {node.payload.error.message || String(node.payload.error)}
            </div>
          )}
          {dataset?.rows ? (
            <EvidenceViews
              node={node}
              run={run}
              outputOnly
              onSelect={onSelect}
              sqlModified={modified}
              caption={`结果 · ${dataset.rows.length.toLocaleString()} 行`}
            />
          ) : (
            <p className="cell-output-empty">
              {running
                ? '查询执行中…'
                : node.status === 'failed'
                ? '执行失败，修正 SQL 后可重跑。'
                : '运行此单元格后，结果将在这里显示。'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Notebook(props: NotebookProps) {
  const { run, busy, drafts, onEdit, onSelect, onContinue, onFork } = props;
  const steps = notebookSteps(run);
  const advanceFrom = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!advanceFrom.current) return;
    if (run.status === 'paused' && run.activeNodeId !== advanceFrom.current) {
      document
        .getElementById(`step-${run.activeNodeId}`)
        ?.querySelector<HTMLTextAreaElement>('textarea')
        ?.focus();
      advanceFrom.current = undefined;
    } else if (!isActive(run)) {
      advanceFrom.current = undefined;
    }
  }, [run.activeNodeId, run.status]);
  const question = run.question || '';
  const firstSentence = question.split(/(?<=[。？！?!])|\n/)[0];
  const title = firstSentence.slice(0, 80);
  const queries = run.nodes
    .filter((node) => node.kind === 'query')
    .sort((a, b) => a.sequence - b.sequence);
  const queryNumbers = new Map(
    queries.map((node, index) => [node.id, index + 1]),
  );
  const source = run.nodes.find((node) => node.kind === 'source');
  const context = run.nodes.find((node) => node.kind === 'context');
  return (
    <div className="notebook-scroll">
      <div className="notebook-paper">
        <header className="notebook-document-header">
          <h1>
            {title}
            {title.length < firstSentence.length ? '…' : ''}
          </h1>
          <p className="notebook-question">{question}</p>
        </header>
        <section
          className="notebook-round source-round"
          aria-label="00 加载数据"
          id={source ? `step-${source.id}` : undefined}
        >
          <div className="round-heading">
            <span className="round-number mono" aria-label="第 0 步">
              00
            </span>
            <h2>加载数据</h2>
            {context && (
              <button
                id={`step-${context.id}`}
                className="text-button"
                onClick={() => onSelect(context.id)}
              >
                字段与口径 <ArrowUpRight size={13} />
              </button>
            )}
          </div>
          <div className="notebook-source">
            <details open>
              <summary>
                <FileSpreadsheet size={15} />
                <strong>{run.source.name}</strong>
                <span>
                  {run.source.rows.toLocaleString()} 行 ·{' '}
                  {run.source.headers.length} 个字段 · 预览前{' '}
                  {run.source.preview.length} 行
                </span>
              </summary>
              <div className="notebook-source-preview">
                <DataTable
                  rows={run.source.preview}
                  columns={run.source.headers}
                />
              </div>
            </details>
          </div>
        </section>
        {steps.map((step, index) => {
          const node = step.node;
          const ownQueries = step.nodes.filter((item) => item.kind === 'query');
          const final = step.nodes.find((item) => item.kind === 'conclusion');
          const narrative = stepNarrative(run, step);
          const pending =
            run.status === 'paused' &&
            run.activeNodeId === node.id &&
            node.kind !== 'query';
          const canGuide =
            node.kind === 'reason' &&
            !!node.checkpoint &&
            (pending || !isActive(run));
          const state =
            isActive(run) &&
            step.nodes.some((item) => item.id === run.activeNodeId)
              ? run.status
              : step.nodes.some((item) => item.status === 'failed')
              ? 'failed'
              : node.status;
          const datasets = stepDatasets(run, step);
          const queryIds = new Set(ownQueries.map((query) => query.id));
          return (
            <article
              key={node.id}
              id={node.kind === 'query' ? undefined : `step-${node.id}`}
              className={`notebook-round ${final ? 'final-round' : ''}`}
            >
              {step.nodes
                .filter(
                  (item) =>
                    item.id !== node.id &&
                    item.kind !== 'query' &&
                    !(
                      item.kind === 'result' &&
                      item.parents.some((id) => queryIds.has(id))
                    ),
                )
                .map((item) => (
                  <span
                    id={`step-${item.id}`}
                    key={item.id}
                    className="step-anchor"
                  />
                ))}
              <div className="round-heading">
                <span
                  className="round-number mono"
                  aria-label={`第 ${index + 1} 轮`}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h2>{node.title.replace(/^第 \d+ 轮 · /, '')}</h2>
                {!['succeeded', 'completed'].includes(state) && (
                  <span className={`status status-${state}`}>
                    {statusLabels[state] || state}
                  </span>
                )}
                <button
                  className="icon-button"
                  aria-label={`查看 ${node.title} 的证据详情`}
                  onClick={() => onSelect(node.id)}
                >
                  <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="round-prose">
                <AnalysisText text={narrative.introduction} />
              </div>
              {node.payload.finalAttempt && (
                <div className="notice">轮次上限后的最终尝试 · 待验证</div>
              )}
              {node.kind !== 'query' && node.payload.error && (
                <div role="alert" className="notice error-notice">
                  {node.payload.error.message || String(node.payload.error)}
                </div>
              )}
              {ownQueries.map((query) => (
                <QueryCell
                  {...props}
                  key={query.id}
                  node={query}
                  number={queryNumbers.get(query.id)!}
                  draft={drafts[query.id] || {}}
                  onContinue={(decision, nextMode) => {
                    if (document.activeElement?.tagName === 'TEXTAREA')
                      advanceFrom.current = query.id;
                    onContinue(decision, nextMode);
                  }}
                />
              ))}
              {!ownQueries.length && datasets.length > 0 && (
                <details className="round-evidence">
                  <summary>查看本轮引用的 {datasets.length} 份依据</summary>
                  <EvidenceViews
                    node={node}
                    run={run}
                    datasets={datasets}
                    onSelect={onSelect}
                    outputOnly
                  />
                </details>
              )}
              {step.nodes
                .filter((item) => item.kind === 'chart')
                .map((chart) => (
                  <EvidenceViews
                    key={chart.id}
                    node={chart}
                    run={run}
                    onSelect={onSelect}
                    outputOnly
                  />
                ))}
              {narrative.review ? (
                <details className="round-review">
                  <summary>
                    后续核验 · 第{' '}
                    {String((narrative.review.step ?? 0) + 1).padStart(2, '0')}{' '}
                    步
                  </summary>
                  <AnalysisText text={narrative.conclusion} />
                </details>
              ) : (
                !narrative.provisional && (
                  <div className="round-finding">
                    <div>
                      <strong>{final ? '分析结论' : '本步结论'}</strong>
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
                )
              )}
              {canGuide && (
                <details
                  className="round-intervention"
                  open={pending || undefined}
                >
                  <summary>
                    {pending ? (
                      <CirclePause size={14} />
                    ) : (
                      <GitBranch size={14} />
                    )}
                    {pending
                      ? '已暂停 · 调整本轮分析'
                      : '补充要求，从本轮重新分析'}
                  </summary>
                  <label className="field">
                    补充要求
                    <textarea
                      aria-label={`第 ${index + 1} 轮的补充要求`}
                      value={drafts[node.id]?.instruction || ''}
                      maxLength={8000}
                      placeholder="例如：只看线上渠道，并核对异常值。"
                      onChange={(event) =>
                        onEdit(node.id, { instruction: event.target.value })
                      }
                    />
                  </label>
                  <button
                    className="button secondary small"
                    disabled={browserMode || busy}
                    onClick={() =>
                      pending
                        ? onContinue(
                            { instruction: drafts[node.id]?.instruction },
                            'step',
                          )
                        : onFork(node.id)
                    }
                  >
                    <Play size={12} />
                    {pending ? '运行本轮' : '新建分支并重跑'}
                  </button>
                </details>
              )}
            </article>
          );
        })}
        {['running', 'pausing'].includes(run.status) && (
          <div className="notebook-tail" role="status">
            <LoaderCircle size={14} className="spin" />
            <span>
              {run.status === 'pausing'
                ? '完成当前操作后暂停…'
                : 'AVA 正在续写分析笔记…'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
