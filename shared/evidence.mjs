export const terminal = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export function putNode(run, id, fields) {
  let node = run.nodes.find((n) => n.id === id);
  if (!node) {
    node = {
      id,
      sequence: run.nodes.length,
      parents: [],
      createdAt: new Date().toISOString(),
      payload: {},
    };
    run.nodes.push(node);
  }
  Object.assign(node, fields);
  return node;
}

export function eventNodeId(event) {
  const match = event.context?.eventId?.match(/^(.+):(start|end)$/);
  return match && event.type.endsWith(match[2]) ? match[1] : undefined;
}

function stepOutputs(run, stepId) {
  const nodes = run.nodes.filter(
    (node) =>
      node.stepId === stepId && !['chart', 'conclusion'].includes(node.kind),
  );
  const inputs = new Set(nodes.flatMap((node) => node.parents));
  return nodes.filter((node) => !inputs.has(node.id));
}

export function applyEvent(run, event) {
  const data = event.data || {};
  if (event.type === 'sourceend')
    return [
      putNode(run, 'source', { status: data.error ? 'failed' : 'succeeded' }),
    ];
  const { eventId, stepId, parentStepIds = [] } = event.context || {};
  const nodeId = eventNodeId(event);
  if (!nodeId || !stepId) return [];
  const kind = {
    stepstart: 'step',
    translatestart: 'translate',
    querystart: 'query',
    summarizestart: 'summary',
  }[event.type];
  if (kind) {
    const step = run.nodes.filter((node) => node.stepId === stepId);
    const parent =
      kind === 'summary'
        ? run.nodes.find(
            (node) =>
              node.id === data.queryId &&
              node.stepId === stepId &&
              node.kind === 'result',
          )
        : kind === 'step'
        ? undefined
        : step.findLast(
            (node) => node.kind === (kind === 'query' ? 'translate' : 'query'),
          ) || step.find((node) => node.kind === 'step');
    const parents = parent
      ? [parent.id]
      : kind === 'step'
      ? parentStepIds.flatMap((id) =>
          stepOutputs(run, id).map((node) => node.id),
        )
      : [];
    if (
      !parents.length &&
      kind === 'step' &&
      run.nodes.some((node) => node.id === 'context')
    )
      parents.push('context');
    const node = putNode(run, nodeId, {
      kind,
      stepId,
      parentStepIds,
      parents,
      title:
        kind === 'step'
          ? run.strategy === 'direct'
            ? '快速分析'
            : data.finalAttempt
            ? '最终查询'
            : `分析步骤 ${data.step + 1}`
          : kind === 'translate'
          ? data.attempt
            ? '修正查询'
            : '快速分析'
          : kind === 'query'
          ? `查询 ${
              step.filter((node) => node.kind === 'query').length + 1
            } · 获取数据`
          : '解释与总结',
      status: 'running',
      startedAt: Date.now(),
      payload: { ...data, ...(data.dsl ? { sql: data.dsl } : {}) },
    });
    run.activeNodeId = nodeId;
    return [node];
  }
  if (
    !['stepend', 'translateend', 'queryend', 'summarizeend'].includes(
      event.type,
    )
  )
    return [];
  const node = run.nodes.find(
    (node) => node.id === nodeId && node.stepId === stepId,
  );
  if (!node) return [];
  node.status = data.error ? 'failed' : 'succeeded';
  node.duration = Date.now() - node.startedAt;
  if (event.type !== 'queryend' || data.error) {
    node.payload = {
      ...node.payload,
      ...data,
      ...(data.dsl ? { sql: data.dsl } : {}),
    };
    if (event.type === 'stepend' && run.strategy === 'loop')
      node.title = data.finalAttempt
        ? '最终查询'
        : {
            EXPLORE: '探索数据',
            REFINE: '修正分析',
            SQL: '执行查询',
            CONFIRM: '核验结论',
          }[data.action] || node.title;
    return [node];
  }
  const result = putNode(run, eventId, {
    kind: 'result',
    stepId,
    parents: [nodeId],
    status: 'succeeded',
    title: data.truncated
      ? `结果 · ${data.data.length} 行（截断）`
      : `结果 · ${data.rowCount ?? data.data.length} 行`,
    payload: data,
  });
  return [node, result];
}

export function completeRun(run, result) {
  const step = run.nodes.findLast((node) => node.kind === 'step');
  if (!step || step.status !== 'succeeded')
    throw new Error('分析缺少成功结束的步骤事件');
  const summary = run.nodes.findLast(
    (node) =>
      node.kind === 'summary' &&
      node.stepId === step.stepId &&
      node.status === 'succeeded',
  );
  if (run.strategy === 'direct' && !summary)
    throw new Error('分析缺少总结事件，请检查 AVA 构建');
  const confirmed = step.payload.action === 'CONFIRM';
  const conclusion =
    summary?.payload.conclusion ||
    (confirmed ? step.payload.text.replace(/^\[CONFIRM\]\s*/, '') : undefined);
  const node = putNode(run, 'conclusion', {
    kind: 'conclusion',
    stepId: step.stepId,
    parents: summary
      ? [summary.id]
      : stepOutputs(run, step.stepId).map((node) => node.id),
    title: conclusion ? '分析结论' : '查询结果（未核验）',
    status: 'succeeded',
    payload: { ...result, conclusion },
  });
  run.activeNodeId = node.id;
  run.result = {
    ...result,
    ...(summary
      ? Object.fromEntries(
          ['queryExplanation', 'limitations', 'conclusion', 'nextStep']
            .filter((key) => summary.payload[key] !== undefined)
            .map((key) => [key, summary.payload[key]]),
        )
      : {}),
  };
  run.status = 'completed';
  return node;
}

export const runSummary = ({ nodes, events, ...run }) => ({
  ...run,
  nodeCount: nodes.length,
});

export const publicRun = (run) => ({ ...runSummary(run), nodes: run.nodes });
