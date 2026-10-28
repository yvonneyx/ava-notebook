export const terminal = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);
export const checkpointId = (state) =>
  state.phase === 'model'
    ? `m-${state.step}`
    : state.phase === 'query'
    ? `q-${state.step}-${state.pending.index}`
    : 'conclusion';
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
export function applyEvent(run, event) {
  const data = event.data || {};
  if (event.type === 'sourceend')
    return [
      putNode(run, 'source', { status: data.error ? 'failed' : 'succeeded' }),
    ];
  if (event.type === 'schemaend' && data.schema)
    return [
      putNode(run, 'context', {
        kind: 'context',
        title: '结构与数据质量',
        status: 'succeeded',
        parents: ['source'],
        payload: { schema: data.schema },
      }),
    ];
  if (event.type === 'profileend' && data.profile) {
    const context = run.nodes.find((n) => n.id === 'context');
    if (context) {
      context.payload.profile = data.profile;
      return [context];
    }
  }
  if (event.type === 'loopstep') {
    const previous = data.step ? `m-${data.step - 1}` : 'context';
    const parents =
      data.phase === 'model'
        ? [
            previous,
            ...run.nodes
              .filter((n) => n.kind === 'result' && n.step === data.step - 1)
              .map((n) => n.id),
          ].filter((id) => run.nodes.some((n) => n.id === id))
        : data.phase === 'query'
        ? [`m-${data.step}`]
        : run.nodes
            .filter((n) => n.kind === 'reason' || n.kind === 'result')
            .slice(-2)
            .map((n) => n.id);
    run.activeNodeId = data.stepId;
    return [
      putNode(run, data.stepId, {
        kind:
          data.phase === 'model'
            ? 'reason'
            : data.phase === 'query'
            ? 'query'
            : 'conclusion',
        title:
          data.phase === 'model'
            ? `第 ${data.step + 1} 轮 · 分析`
            : data.phase === 'query'
            ? `查询 ${data.queryIndex + 1} · ${
                data.action === 'SQL' ? '答案验证' : '探索数据'
              }`
            : '分析结论',
        status: 'ready',
        step: data.step,
        parents,
        payload:
          data.phase === 'query'
            ? { sql: data.dsl, action: data.action }
            : data.phase === 'complete'
            ? { text: data.text, completionReason: data.completionReason }
            : {},
      }),
    ];
  }
  const node = run.nodes.find((n) => n.id === run.activeNodeId);
  if (!node) return [];
  if (event.type === 'reasonstart' || event.type === 'querystart') {
    node.status = 'running';
    node.startedAt = Date.now();
    if (data.dsl) node.payload.sql = data.dsl;
    if (data.prompt) node.payload.prompt = data.prompt;
  } else if (event.type === 'reasonend') {
    node.status = data.error ? 'failed' : 'succeeded';
    node.payload = { ...node.payload, ...data };
    node.duration = Date.now() - (node.startedAt || Date.now());
    node.title = `第 ${(data.step ?? node.step) + 1} 轮 · ${
      {
        EXPLORE: '探索数据',
        REFINE: '修正计划',
        SQL: '生成答案查询',
        CONFIRM: '检查与确认',
      }[data.action] || '分析失败'
    }`;
  } else if (event.type === 'queryend') {
    node.status = data.error ? 'failed' : 'succeeded';
    node.duration = Date.now() - (node.startedAt || Date.now());
    if (data.error) node.payload.error = data.error;
    else {
      const result = putNode(run, `${node.id}-result`, {
        kind: 'result',
        step: node.step,
        parents: [node.id],
        status: 'succeeded',
        title: data.truncated
          ? `结果 · ${data.data.length} 行（截断）`
          : `结果 · ${data.rowCount ?? data.data.length} 行`,
        payload: {
          data: data.data,
          schema: data.schema,
          rowCount: data.rowCount,
          truncated: data.truncated,
          truncatedBy: data.truncatedBy,
        },
      });
      return [node, result];
    }
  } else return [];
  return [node];
}
export function forkPrefix(run, nodeId) {
  const selected = run.nodes.find((n) => n.id === nodeId && n.checkpoint);
  if (!selected) throw new Error('该节点没有可恢复的检查点');
  return run.nodes
    .filter((n) => n.sequence < selected.sequence)
    .map((n) => ({ ...structuredClone(n), inherited: true }));
}
export const runSummary = ({ nodes, events, ...run }) => ({
  ...run,
  nodeCount: nodes.length,
});
