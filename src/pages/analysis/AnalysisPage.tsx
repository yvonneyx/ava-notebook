import { lazy, Suspense, ViewTransition, startTransition } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Run } from '../../../shared/contracts';
import Notebook from '../../features/notebook/Notebook';
import EvidenceDetail from '../../features/evidence/EvidenceDetail';
import RunToolbar from './RunToolbar';
import type { useRun } from './useRun';
const Graph = lazy(() => import('../../features/graph/Graph'));

export default function AnalysisPage({
  run,
  analysis,
  busy,
  onRetry,
  onStop,
  onChart,
}: {
  run: Run;
  analysis: ReturnType<typeof useRun>;
  busy: boolean;
  onRetry: () => void;
  onStop: () => void;
  onChart: (nodeId: string, x: string, y: string) => void;
}) {
  const { view, selected, setSelected, selectNode } = analysis;
  const node = run.nodes.find((item) => item.id === selected);
  return (
    <div className="workspace">
      {run.error && (
        <div className="run-error notice error-notice">
          {run.error}
          <button className="text-button" onClick={onRetry}>
            使用此数据重新分析 ↗
          </button>
        </div>
      )}
      <RunToolbar run={run} analysis={analysis} busy={busy} onStop={onStop} />
      <div className="work-body">
        <div className="work-canvas">
          <ViewTransition
            key={view}
            default="none"
            enter="fade-in"
            exit="fade-out"
          >
            {view === 'notebook' ? (
              <Notebook
                key={run.id}
                run={run}
                selected={selected}
                onSelect={selectNode}
              />
            ) : (
              <ViewTransition default="none" update="morph">
                <Suspense
                  fallback={
                    <div className="loading">
                      <LoaderCircle className="spin" />
                      加载证据图谱…
                    </div>
                  }
                >
                  <Graph
                    key={run.id}
                    nodes={run.nodes}
                    selected={selected}
                    onSelect={selectNode}
                  />
                </Suspense>
              </ViewTransition>
            )}
          </ViewTransition>
        </div>
        {node && (
          <ViewTransition
            default="none"
            enter="slide-from-right"
            exit="slide-to-right"
          >
            <EvidenceDetail
              key={`${run.id}-${node.id}`}
              node={node}
              run={run}
              busy={busy}
              onClose={() => startTransition(() => setSelected(''))}
              onSelect={selectNode}
              onChart={onChart}
            />
          </ViewTransition>
        )}
      </div>
    </div>
  );
}
