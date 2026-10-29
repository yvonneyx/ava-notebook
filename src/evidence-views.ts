import type { Evidence, Run } from './types';

export type EvidenceDataset = {
  id: string;
  label: string;
  query?: Evidence;
  result?: Evidence;
  rows?: Record<string, unknown>[];
  columns: string[];
  preview?: boolean;
  truncated?: boolean;
  total?: number;
};

/** Follow recorded edges, never the latest result elsewhere in the run. */
export function evidenceDatasets(run: Run, node: Evidence): EvidenceDataset[] {
  const byId = new Map(run.nodes.map((item) => [item.id, item]));
  if (node.kind === 'source' || node.kind === 'context') {
    return [
      {
        id: run.source.id,
        label: 'CSV 数据预览',
        rows: run.source.preview,
        columns: run.source.headers,
        preview: true,
        total: run.source.rows,
      },
    ];
  }
  const datasets = new Map<string, EvidenceDataset>();
  function add(item: Evidence, prefix = '') {
    const query =
      item.kind === 'query'
        ? item
        : item.parents
            .map((id) => byId.get(id))
            .find((parent) => parent?.kind === 'query');
    const result =
      item.kind === 'result'
        ? item
        : run.nodes.find(
            (candidate) =>
              candidate.kind === 'result' &&
              candidate.parents.includes(item.id),
          );
    const id = query?.id || item.id;
    if (datasets.has(id)) return;
    const rows = result?.payload.data as Record<string, unknown>[] | undefined;
    datasets.set(id, {
      id,
      label: prefix + (query ? query.title : item.title),
      query,
      result,
      rows,
      columns:
        result?.payload.schema?.map(
          (column: { name: string }) => column.name,
        ) || Object.keys(rows?.[0] || {}),
      truncated: !!result?.payload.truncated,
      total: result?.payload.rowCount,
    });
  }
  if (node.kind === 'query' || node.kind === 'result') {
    add(node);
  } else if (node.kind === 'translate' || node.kind === 'step') {
    // The model's own queries and its direct input results have different provenance.
    run.nodes
      .filter(
        (item) =>
          item.kind === 'query' &&
          (node.kind === 'step'
            ? item.stepId === node.stepId
            : item.parents.includes(node.id)),
      )
      .forEach((item) => add(item));
    const pending = [...node.parents];
    const seen = new Set<string>();
    while (pending.length) {
      const id = pending.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const parent = byId.get(id);
      if (parent?.kind === 'result') add(parent, '输入依据 · ');
      else if (parent) pending.push(...parent.parents);
    }
  } else if (['chart', 'conclusion', 'summary'].includes(node.kind)) {
    const seen = new Set<string>();
    const pending = [...node.parents];
    const ancestors: Evidence[] = [];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const parent = byId.get(id);
      if (!parent) continue;
      if (parent.kind === 'query' || parent.kind === 'result')
        ancestors.push(parent);
      else pending.push(...parent.parents);
    }
    // A saved chart belongs only to its result, not earlier results used to plan that query.
    const relevant =
      node.kind === 'chart'
        ? ancestors.filter((item) => node.parents.includes(item.id))
        : ancestors;
    relevant
      .sort((a, b) => b.sequence - a.sequence)
      .forEach((item) => add(item));
  }
  return [...datasets.values()];
}

function numericValue(value: unknown, csv: boolean): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (
    csv &&
    typeof value === 'string' &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  ) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
}

export function numericColumns(dataset: EvidenceDataset): string[] {
  return dataset.columns.filter((column) =>
    dataset.rows?.some(
      (row) => numericValue(row[column], !!dataset.preview) !== undefined,
    ),
  );
}

/** Preview the saved rows without aggregation or another SQL execution. */
export function chartPreview(dataset: EvidenceDataset, x: string, y: string) {
  const input = (dataset.rows || []).slice(0, 20);
  const rows = input.flatMap((row, index) => {
    const value = numericValue(row[y], !!dataset.preview);
    return value === undefined
      ? []
      : [
          {
            label: x ? String(row[x] ?? '∅') : String(index + 1),
            value,
          },
        ];
  });
  return {
    rows,
    omitted: input.length - rows.length,
    limited: !!dataset.truncated || (dataset.rows?.length || 0) > 20,
    canSave:
      !!dataset.result &&
      !!x &&
      rows.length > 0 &&
      input.every(
        (row) => typeof row[y] === 'number' && Number.isFinite(row[y]),
      ),
  };
}
