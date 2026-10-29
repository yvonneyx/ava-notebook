import { useCallback, useState } from 'react';
import type { Run } from '../../../shared/contracts';
import { api } from '../../runtime/client';

export function useRunHistory() {
  const [runs, setRuns] = useState<Run[]>([]);
  async function refresh() {
    setRuns(await api<Run[]>('/runs'));
  }
  async function remove(id: string) {
    await api(`/runs/${id}`, { method: 'DELETE' });
    setRuns((current) => current.filter((item) => item.id !== id));
  }
  const update = useCallback((id: string, metadata: Omit<Run, 'nodes'>) => {
    setRuns((current) =>
      current.map((item) => (item.id === id ? { ...item, ...metadata } : item)),
    );
  }, []);
  return { runs, refresh, remove, update };
}
