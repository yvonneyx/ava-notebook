import type { Evidence, Run } from '../../shared/contracts';

export type RunUpdate = { metadata: Omit<Run, 'nodes'>; nodes: Evidence[] };

export function mergeRunUpdate(
  current: Run | null,
  id: string,
  { metadata, nodes }: RunUpdate,
) {
  if (!current || current.id !== id || metadata.revision <= current.revision)
    return current;
  const merged = new Map(current.nodes.map((node) => [node.id, node]));
  nodes.forEach((node) => merged.set(node.id, node));
  return {
    ...current,
    ...metadata,
    nodes: [...merged.values()].sort((a, b) => a.sequence - b.sequence),
  };
}
