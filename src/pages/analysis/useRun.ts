import { useEffect, useState, startTransition } from 'react';
import type { Run } from '../../../shared/contracts';
import { post, subscribeRun } from '../../runtime/client';
import { mergeRunUpdate } from '../../domain/run-updates';

export function useRun(
  updateHistory: (id: string, metadata: Omit<Run, 'nodes'>) => void,
) {
  const [run, setRun] = useState<Run | null>(null);
  const [view, setView] = useState<'notebook' | 'graph'>('notebook');
  const [selected, setSelected] = useState('');
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    if (!run?.id) return;
    const id = run.id;
    return subscribeRun(id, {
      onConnection: setConnected,
      onSnapshot: (snapshot) =>
        setRun((current) =>
          current?.id === id && snapshot.revision >= current.revision
            ? snapshot
            : current,
        ),
      onUpdate: (update) => {
        setRun((current) => mergeRunUpdate(current, id, update));
        updateHistory(id, update.metadata);
      },
    });
  }, [run?.id, updateHistory]);
  function jumpToStep(id: string) {
    setView('notebook');
    setSelected('');
    requestAnimationFrame(() =>
      document
        .getElementById(`step-${id}`)
        ?.scrollIntoView({ block: 'center' }),
    );
  }
  function selectNode(id: string) {
    startTransition(() => setSelected(id));
  }
  async function stop() {
    if (!run) return;
    const updated = await post<Run>(`/runs/${run.id}/control`, {
      command: 'stop',
      requestId: crypto.randomUUID(),
    });
    setRun((current) =>
      current?.id === updated.id && current.revision > updated.revision
        ? current
        : updated,
    );
  }
  async function saveChart(nodeId: string, x: string, y: string) {
    if (!run) return;
    const next = await post<Run>(`/runs/${run.id}/charts`, { nodeId, x, y });
    setRun((current) =>
      current?.id === next.id && current.revision > next.revision
        ? current
        : next,
    );
    setSelected(next.nodes.at(-1)!.id);
  }
  return {
    run,
    setRun,
    view,
    setView,
    selected,
    setSelected,
    connected,
    jumpToStep,
    selectNode,
    stop,
    saveChart,
  };
}
