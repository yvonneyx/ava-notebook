import type { Run } from '../../shared/contracts';

export const statusLabels: Record<string, string> = {
  running: '执行中',
  succeeded: '已完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  interrupted: '已中断',
};
export const kindLabels: Record<string, string> = {
  step: '分析步骤',
  source: 'CSV 数据源',
  context: '数据结构',
  translate: '生成查询',
  summary: '解释与总结',
  query: 'SQL 执行',
  result: '查询结果',
  conclusion: '分析结论',
  chart: '结果图表',
};
export const isActive = (run?: Run | null) => run?.status === 'running';
