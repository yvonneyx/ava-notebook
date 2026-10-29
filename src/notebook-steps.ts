import type { Evidence, Run } from './types';
import { evidenceDatasets } from './evidence-views';

export type NotebookStep = { node: Evidence; nodes: Evidence[] };

export function notebookSteps(run: Run): NotebookStep[] {
  const groups = new Map<string, NotebookStep>();
  for (const node of [...run.nodes].sort((a, b) => a.sequence - b.sequence)) {
    if (!node.stepId) continue;
    const group = groups.get(node.stepId) || { node, nodes: [] };
    if (node.kind === 'step') group.node = node;
    group.nodes.push(node);
    groups.set(node.stepId, group);
  }
  return [...groups.values()];
}

export function stepDatasets(run: Run, step: NotebookStep) {
  return step.nodes
    .filter((node) => node.kind === 'query')
    .flatMap((node) => evidenceDatasets(run, node));
}

export function stepNarrative(run: Run, step: NotebookStep) {
  if (run.strategy === 'loop') {
    const final = step.nodes.find((node) => node.kind === 'conclusion');
    return {
      introduction:
        (step.node.payload.action === 'CONFIRM' && final) ||
        (step.node.payload.action === 'SQL' &&
          step.nodes.some((node) => node.kind === 'query'))
          ? ''
          : step.node.payload.text ||
            (step.node.status === 'running'
              ? '正在分析数据…'
              : '本步骤未返回分析说明。'),
      limitations: undefined,
      conclusion: final?.payload.conclusion,
      nextStep: undefined,
      unconfirmed: !!final && step.node.payload.action !== 'CONFIRM',
    };
  }
  const summary = step.nodes.find((node) => node.kind === 'summary');
  const report = summary?.status === 'succeeded' ? summary.payload : {};
  return {
    introduction:
      report.queryExplanation ||
      (['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)
        ? '本次分析未生成查询说明。'
        : '查询完成后将生成查询说明。'),
    limitations: report.limitations,
    conclusion: report.conclusion,
    nextStep: report.nextStep,
    unconfirmed: false,
  };
}
