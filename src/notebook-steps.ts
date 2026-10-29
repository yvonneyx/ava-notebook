import type { Evidence, Run } from './types';
import { evidenceDatasets } from './evidence-views';

export type NotebookStep = { node: Evidence; nodes: Evidence[] };

/** Group telemetry by its model round; preserve every original node for inspection. */
export function notebookSteps(run: Run): NotebookStep[] {
  const nodes = [...run.nodes].sort((a, b) => a.sequence - b.sequence);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const models = new Map(
    nodes
      .filter((node) => node.kind === 'reason' && node.step !== undefined)
      .map((node) => [node.step, node]),
  );
  const groups = new Map<string, NotebookStep>();
  function owner(
    node: Evidence,
    seen = new Set<string>(),
  ): Evidence | undefined {
    if (seen.has(node.id) || ['source', 'context'].includes(node.kind)) return;
    seen.add(node.id);
    if (node.kind === 'reason') return node;
    const model = node.step === undefined ? undefined : models.get(node.step);
    if (model) return model;
    for (const id of node.parents) {
      const parent = byId.get(id);
      const result = parent && owner(parent, seen);
      if (result) return result;
    }
    return node;
  }
  for (const node of nodes) {
    if (['source', 'context'].includes(node.kind)) continue;
    const model = owner(node) || node;
    const group = groups.get(model.id) || { node: model, nodes: [] };
    group.nodes.push(node);
    groups.set(model.id, group);
  }
  return [...groups.values()].sort((a, b) => a.node.sequence - b.node.sequence);
}

export function stepDatasets(run: Run, step: NotebookStep) {
  const queries = step.nodes.filter((node) => node.kind === 'query');
  // A query-producing round shows its own outputs. A planning round shows its recorded inputs.
  return queries.length
    ? queries.flatMap((node) => evidenceDatasets(run, node))
    : evidenceDatasets(run, step.node);
}

const prose = (text = '') =>
  text
    .replace(/^\[\w+\]\s*/, '')
    .replace(/```[^\n]*\n[\s\S]*?```/g, '')
    .trim();
function section(text: string, heading: string) {
  return text
    .match(
      new RegExp(
        `(?:^|\\n)(?:#{1,6}\\s*)?\\*{0,2}(?:${heading})[:：]\\*{0,2}\\s*([\\s\\S]*?)(?=\\n(?:#{1,6}\\s*)?\\*{0,2}(?:Findings|Plan|Next|Verification|Conclusion|发现|计划|结论|阶段结论)[:：]|$)`,
        'i',
      ),
    )?.[1]
    .trim();
}
export function stepNarrative(run: Run, step: NotebookStep) {
  const text = prose(step.node.payload.text);
  const action = step.node.payload.action;
  const introduction =
    action === 'REFINE'
      ? section(text, 'Plan|计划') || '根据上一轮证据修正分析计划。'
      : action === 'CONFIRM'
      ? section(text, 'Verification') || '核对答案查询的口径、结果和原始问题。'
      : text.replace(/^--\s*Purpose:\s*/gim, '') ||
        (action === 'SQL'
          ? '使用已核验的口径生成答案查询，执行后检查结果。'
          : '检查已有证据，确定本轮要解决的问题。');
  const final = step.nodes.find((node) => node.kind === 'conclusion');
  if (final)
    return {
      introduction,
      conclusion:
        section(prose(final.payload.text), 'Conclusion|结论') ||
        prose(final.payload.text),
    };
  const own =
    action === 'REFINE'
      ? section(text, 'Findings|发现')
      : action === 'CONFIRM'
      ? section(text, 'Conclusion|结论')
      : undefined;
  if (own) return { introduction, conclusion: own };
  const results = step.nodes.filter((node) => node.kind === 'result');
  const review = run.nodes
    .filter(
      (node) =>
        node.kind === 'reason' &&
        node.sequence > step.node.sequence &&
        node.parents.some((id) => results.some((result) => result.id === id)),
    )
    .sort((a, b) => a.sequence - b.sequence)
    .find((node) => ['REFINE', 'CONFIRM'].includes(node.payload.action));
  const finding =
    review &&
    section(
      prose(review.payload.text),
      review.payload.action === 'REFINE' ? 'Findings|发现' : 'Conclusion|结论',
    );
  if (finding) return { introduction, conclusion: finding, review };
  const queries = step.nodes.filter((node) => node.kind === 'query');
  return {
    introduction,
    conclusion: queries.some((node) => node.status === 'failed')
      ? '查询未全部成功，需要修正后再形成结论。'
      : results.length
      ? `已取得 ${results.length} 份查询结果；${
          ['completed', 'failed', 'cancelled', 'interrupted'].includes(
            run.status,
          )
            ? '模型未返回本步的独立业务结论，可在 Data / Chart 查看证据。'
            : '业务解释等待后续模型核验。'
        }`
      : queries.length
      ? '等待查询执行，尚无本步结论。'
      : '本轮尚未形成结论。',
  };
}
