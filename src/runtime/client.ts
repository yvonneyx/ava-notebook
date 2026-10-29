import { remoteApi, subscribeRemoteRun } from './remote';
import type { RunObserver } from './remote';
export const browserMode = import.meta.env.MODE === 'static';

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (browserMode) {
    const { browserApi } = await import('./static');
    return browserApi<T>(path, options);
  }
  return remoteApi<T>(path, options);
}
export const post = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export function subscribeRun(id: string, observer: RunObserver) {
  return browserMode ? undefined : subscribeRemoteRun(id, observer);
}
export async function readDraft<T>() {
  if (!browserMode) return undefined;
  const { readLocal } = await import('./indexed-db');
  return readLocal<T>('drafts', 'composer');
}
export async function saveDraft(draft: unknown) {
  if (!browserMode) return;
  const { writeLocal } = await import('./indexed-db');
  await writeLocal('drafts', 'composer', draft);
}
