import { ArrowUpRight, LoaderCircle, FileSpreadsheet } from 'lucide-react';
import type { Evidence, Run } from '../../../shared/contracts';
import { isActive } from '../../domain/status';
import StatusLabel from '../../ui/StatusLabel';
import EvidenceViews from '../evidence/EvidenceViews';
import AnalysisText from '../../ui/AnalysisText';
import SqlCode from '../../ui/SqlCode';
import { DataTable } from '../../ui/DataTable';
import { notebookSteps, stepNarrative } from './steps';
import { evidenceDatasets } from '../../domain/evidence';

type NotebookProps = {
  run: Run;
  selected?: string;
  onSelect: (id: string) => void;
};

function QueryCell({
  node,
  number,
  run,
  selected,
  onSelect,
}: NotebookProps & { node: Evidence; number: number }) {
  const running = run.activeNodeId === node.id && isActive(run);
  const dataset = evidenceDatasets(run, node)[0];
  const input = (
    <details
      className="cell-input"
      open={running || node.status === 'failed' || !dataset?.rows || undefined}
    >
      <summary
        className="cell-toolbar"
        aria-label={`查看查询 ${number} 的 SQL`}
      >
        <span>
          查询 {number} <span className="cell-language">SQL</span>
        </span>
        <div>
          {node.status !== 'succeeded' && (
            <span className={`status status-${node.status}`}>
              <StatusLabel status={node.status} />
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
        <pre className="cell-editor mono">
          <SqlCode sql={node.payload.sql} />
        </pre>
      </div>
    </details>
  );
  const output = (
    <div
      className="cell-output"
      id={dataset?.result ? `step-${dataset.result.id}` : undefined}
    >
      <div className="cell-output-body">
        {node.payload.error && (
          <div role="alert" className="notice error-notice">
            {node.payload.error.message}
          </div>
        )}
        {dataset?.rows ? (
          <EvidenceViews
            node={node}
            run={run}
            outputOnly
            onSelect={onSelect}
            caption={`结果 · ${dataset.rows.length.toLocaleString()} 行`}
          />
        ) : (
          <p className="cell-output-empty">
            {running
              ? '查询执行中…'
              : node.status === 'failed'
              ? '查询失败，错误信息已保留。'
              : '尚无查询结果。'}
          </p>
        )}
      </div>
    </div>
  );
  return (
    <section
      id={`step-${node.id}`}
      aria-label={`SQL 单元格 ${number}`}
      className={`query-cell ${selected === node.id ? 'inspected' : ''}`}
    >
      {input}
      {output}
    </section>
  );
}

export default function Notebook({ run, selected, onSelect }: NotebookProps) {
  const direct = run.strategy === 'direct';
  const steps = notebookSteps(run);
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
          {run.caseStudy?.recorded && (
            <p className="notebook-question">
              经典案例 · 示例回放
            </p>
          )}
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
          const queries = step.nodes.filter((item) => item.kind === 'query');
          const final = step.nodes.find((item) => item.kind === 'conclusion');
          const narrative = stepNarrative(run, step);
          const state = node.status;
          const outputs = (
            <>
              {queries.map((query) => (
                <QueryCell
                  key={query.id}
                  node={query}
                  number={queryNumbers.get(query.id)!}
                  run={run}
                  selected={selected}
                  onSelect={onSelect}
                />
              ))}
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
              {direct && !queries.length && !isActive(run) && (
                <p className="cell-output-empty">
                  本次分析未生成查询结果。
                </p>
              )}
            </>
          );
          return (
            <article
              key={node.id}
              id={`step-${node.id}`}
              className={`notebook-round ${direct ? 'direct-round' : ''} ${node.payload.action === 'REFINE' ? 'refine-round' : ''} ${node.payload.action === 'EXPLORE' ? 'explore-round' : ''} ${final ? 'final-round' : ''}`}
            >
              {step.nodes
                .filter(
                  (item) =>
                    item.id !== node.id &&
                    !['query', 'result', 'conclusion'].includes(item.kind),
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
                  aria-label={`第 ${index + 1} 步`}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h2>{node.title}</h2>
                {state !== 'succeeded' && (
                  <span className={`status status-${state}`}>
                    <StatusLabel status={state} />
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
              {narrative.introduction && (
                <div className="round-prose">
                  <strong>{direct ? '查询说明' : '分析过程'}</strong>
                  <AnalysisText text={narrative.introduction} />
                </div>
              )}
              {step.nodes
                .filter((item) => item.kind !== 'query' && item.payload.error)
                .map((item) => (
                  <div
                    key={item.id}
                    role="alert"
                    className="notice error-notice"
                  >
                    {item.payload.error.message}
                  </div>
                ))}
              {outputs}
              {narrative.limitations && (
                <div className="round-prose">
                  <strong>证据局限</strong>
                  <AnalysisText text={narrative.limitations} />
                </div>
              )}
              {narrative.conclusion && (
                <div
                  className="round-finding"
                  id={final ? `step-${final.id}` : undefined}
                >
                  <div>
                    <strong>分析结论</strong>
                    {final && <StatusLabel status="completed" label="分析完成" />}
                  </div>
                  <AnalysisText text={narrative.conclusion} />
                </div>
              )}
              {narrative.unconfirmed && (
                <div
                  className="notice"
                  id={final ? `step-${final.id}` : undefined}
                >
                  查询已完成，本次未收到核验结论。请结合查询结果判断。
                </div>
              )}
              {narrative.nextStep && (
                <div className="round-prose">
                  <strong>后续计划</strong>
                  <AnalysisText text={narrative.nextStep} />
                </div>
              )}
            </article>
          );
        })}
        {isActive(run) && (
          <div className="notebook-tail" role="status">
            <LoaderCircle size={14} className="spin" />
            <span>AVA 正在续写分析笔记…</span>
          </div>
        )}
      </div>
    </div>
  );
}
