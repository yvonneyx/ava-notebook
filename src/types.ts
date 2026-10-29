export type Mode = 'auto' | 'query' | 'step';
export type Source = {
  id: string;
  name: string;
  hash: string;
  rows: number;
  bytes: number;
  headers: string[];
  preview: Record<string, unknown>[];
  semantic?: {
    name: string;
    hash: string;
    definition: Record<string, unknown>;
  };
};
export type Evidence = {
  id: string;
  sequence: number;
  kind: string;
  title: string;
  status: string;
  parents: string[];
  payload: Record<string, any>;
  step?: number;
  checkpoint?: string;
  duration?: number;
  inherited?: boolean;
};
export type Run = {
  id: string;
  question: string;
  source: Source;
  status: string;
  revision: number;
  mode: Mode;
  nodes: Evidence[];
  activeNodeId?: string;
  model: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  nodeCount?: number;
  result?: { completionReason: string; text: string };
};
export type Session = {
  configured: boolean;
  model: string;
  baseURL: string;
  activeRunId?: string;
  build: string;
};
export const statusLabels: Record<string, string> = {
  ready: '待执行',
  running: '执行中',
  pausing: '等待暂停',
  paused: '已暂停',
  succeeded: '已完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  interrupted: '已中断',
};
export const kindLabels: Record<string, string> = {
  source: 'CSV 数据源',
  context: '数据结构',
  reason: '模型分析',
  query: 'SQL 执行',
  result: '查询结果',
  conclusion: '分析结论',
  chart: '结果图表',
};
export const isActive = (run?: Run | null) =>
  !!run && ['running', 'paused', 'pausing'].includes(run.status);
