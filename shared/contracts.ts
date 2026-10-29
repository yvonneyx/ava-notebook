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
export type Visualization = {
  status:
    | 'pending'
    | 'ready'
    | 'empty'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  chartType?: string;
  config?: { type: string; [key: string]: unknown };
  error?: string;
};
export type Evidence = {
  id: string;
  sequence: number;
  kind: string;
  title: string;
  status: string;
  parents: string[];
  payload: Record<string, any>;
  stepId?: string;
  parentStepIds?: string[];
  duration?: number;
  visualization?: Visualization;
};
export type Run = {
  id: string;
  question: string;
  source: Source;
  status: string;
  revision: number;
  strategy: 'direct' | 'loop';
  nodes: Evidence[];
  activeNodeId?: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  nodeCount?: number;
  result?: {
    queryExplanation?: string;
    limitations?: string;
    conclusion?: string;
    nextStep?: string;
  };
  caseStudy?: { title: string; description: string; recorded?: boolean };
};
export type Session = {
  configured: boolean;
  model: string;
  baseURL: string;
  activeRunId?: string;
  build: string;
};
