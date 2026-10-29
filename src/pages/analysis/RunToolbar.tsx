import { startTransition } from 'react';
import { BookOpen, Network, Square, ArrowDown } from 'lucide-react';
import type { Run } from '../../../shared/contracts';
import { isActive } from '../../domain/status';
import StatusLabel from '../../ui/StatusLabel';
import type { useRun } from './useRun';

export default function RunToolbar({
  run,
  analysis,
  busy,
  onStop,
}: {
  run: Run;
  analysis: ReturnType<typeof useRun>;
  busy: boolean;
  onStop: () => void;
}) {
  const { view, setView, connected, jumpToStep } = analysis;
  const active = isActive(run);
  return (
    <div className="workspace-toolbar">
      <div className="segmented" data-view={view}>
        <span className="segment-indicator" aria-hidden="true" />
        <button
          aria-pressed={view === 'notebook'}
          className={view === 'notebook' ? 'active' : ''}
          onClick={() => startTransition(() => setView('notebook'))}
        >
          <BookOpen size={14} />
          Notebook
        </button>
        <button
          aria-pressed={view === 'graph'}
          className={view === 'graph' ? 'active' : ''}
          onClick={() => startTransition(() => setView('graph'))}
        >
          <Network size={14} />
          图谱
        </button>
      </div>
      <div className="run-controls">
        <div className="run-summary" role="group" aria-label="分析模式与状态">
          <span className="run-mode">
            {run.strategy === 'loop' ? '探索模式' : '快速模式'}
          </span>
          <span className={`status status-${run.status}`} role="status">
            <StatusLabel status={run.status} />
          </span>
          {!connected && <span className="amber">连接恢复中…</span>}
        </div>
        {active && (
          <>
            <button
              className="icon-button stop-button"
              disabled={busy}
              title="停止分析"
              aria-label="停止分析"
              onClick={() => onStop()}
            >
              <Square size={13} />
            </button>
          </>
        )}
        {run.nodes.some((n) => n.id === 'conclusion') && !active ? (
          <button
            className="text-button jump-button"
            onClick={() => jumpToStep('conclusion')}
          >
            查看结论
            <ArrowDown size={14} />
          </button>
        ) : (
          run.activeNodeId && (
            <button
              className="icon-button"
              title="定位当前步骤"
              aria-label="定位当前步骤"
              onClick={() => jumpToStep(run.activeNodeId!)}
            >
              <ArrowDown size={15} />
            </button>
          )
        )}
      </div>
    </div>
  );
}
