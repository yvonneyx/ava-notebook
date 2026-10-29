import { X, GitBranch } from 'lucide-react';
import { DataTable } from '../../ui/DataTable';
import EvidenceViews from './EvidenceViews';
import AnalysisText from '../../ui/AnalysisText';
import { kindLabels } from '../../domain/status';
import StatusLabel from '../../ui/StatusLabel';
import type { Evidence, Run } from '../../../shared/contracts';

export default function Detail({
  node,
  run,
  busy,
  onClose,
  onChart,
  onSelect,
}: {
  node: Evidence;
  run: Run;
  busy: boolean;
  onClose: () => void;
  onChart: (nodeId: string, x: string, y: string) => void;
  onSelect: (id: string) => void;
}) {
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
            <StatusLabel status={node.status} />
          </span>
        </div>
        <div className="detail-meta">
          <span>步骤 {String(node.sequence + 1).padStart(2, '0')}</span>
          {node.duration !== undefined && (
            <span>{(node.duration / 1000).toFixed(2)} 秒</span>
          )}
        </div>
        {node.payload.error && (
          <div role="alert" className="notice error-notice">
            {node.payload.error.message}
          </div>
        )}
        {node.payload.error?.responseText !== undefined && (
          <details>
            <summary>模型返回（最多 3000 字符）</summary>
            <pre>{node.payload.error.responseText || '（空响应）'}</pre>
            {node.payload.error.finishReason && (
              <p>结束原因：{node.payload.error.finishReason}</p>
            )}
          </details>
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
            {node.payload.semantic && (
              <details>
                <summary>业务口径与分析思路</summary>
                <pre>{JSON.stringify(node.payload.semantic, null, 2)}</pre>
              </details>
            )}
            <details>
              <summary>查看数据质量统计</summary>
              <pre>{JSON.stringify(node.payload.profile, null, 2)}</pre>
            </details>
          </>
        )}
        {node.payload.query && <AnalysisText text={node.payload.query} />}
        {node.kind === 'step' && node.payload.text && (
          <AnalysisText text={node.payload.text} />
        )}
        {node.kind === 'conclusion' &&
          run.strategy === 'loop' &&
          !node.payload.conclusion && (
            <p className="notice">查询已完成，本次未收到核验结论。</p>
          )}
        {node.payload.queryExplanation && (
          <>
            <h3>查询说明</h3>
            <AnalysisText text={node.payload.queryExplanation} />
          </>
        )}
        {node.payload.limitations && (
          <>
            <h3>证据局限</h3>
            <AnalysisText text={node.payload.limitations} />
          </>
        )}
        {node.payload.conclusion && (
          <>
            <h3>分析结论</h3>
            <AnalysisText text={node.payload.conclusion} />
          </>
        )}
        {node.payload.nextStep && (
          <>
            <h3>后续计划</h3>
            <AnalysisText text={node.payload.nextStep} />
          </>
        )}
        {node.payload.usage && (
          <details>
            <summary>Token 用量</summary>
            <pre>{JSON.stringify(node.payload.usage, null, 2)}</pre>
          </details>
        )}
        <EvidenceViews
          node={node}
          run={run}
          busy={busy}
          onSelect={onSelect}
          onChart={onChart}
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
      </div>
    </aside>
  );
}
