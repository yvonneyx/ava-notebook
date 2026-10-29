import type { Run } from '../../shared/contracts';
import type { RunUpdate } from '../domain/run-updates';
import { readLocal, writeLocal } from './indexed-db';
import { subscribeBrowserRun } from './browser-jobs';

export type RunObserver = {
  onConnection: (connected: boolean) => void;
  onSnapshot: (run: Run) => void;
  onUpdate: (update: RunUpdate) => void;
};

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { browserApi } = await import('./browser');
  return browserApi<T>(path, options);
}
export const post = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const subscribeRun = subscribeBrowserRun;
export const readDraft = <T>() => readLocal<T>('drafts', 'composer');
export const saveDraft = (draft: unknown) =>
  writeLocal('drafts', 'composer', draft);
