import { useState } from 'react';
import { DataTable } from './DataViews';
import EvidenceViews from './EvidenceViews';
import AnalysisText from './AnalysisText';
import {
  X,
  GitBranch,
  Play,
  Copy,
  Check,
  ChevronDown,
  FileCode2,
} from 'lucide-react';
import { kindLabels, statusLabels, isActive } from './types';
import type { Evidence, Run, Mode } from './types';
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
        <EvidenceViews
          node={node}
          run={run}
          busy={busy}
          onSelect={onSelect}
          onChart={onChart}
          sqlModified={node.kind === 'query' && sql !== node.payload.sql}
          sqlPane={
            node.kind === 'query' ? (
              <>
                <div className="section-label">
                  <h3>
                    {sql !== node.payload.sql
                      ? '修改草稿 · 尚未执行'
                      : waiting || node.status === 'ready'
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
            ) : undefined
          }
        />
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
