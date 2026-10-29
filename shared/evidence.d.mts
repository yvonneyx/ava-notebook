import type { Evidence, Run } from './contracts';
export const terminal: Set<string>;
export function putNode(
  run: Run,
  id: string,
  fields: Partial<Evidence>,
): Evidence;
export function eventNodeId(event: any): string | undefined;
export function applyEvent(run: Run, event: any): Evidence[];
export function completeRun(run: Run, result: any): Evidence;
export function runSummary(run: Run): Omit<Run, 'nodes'>;
export function publicRun(run: Run): Run;
