import type { Run } from '../../shared/contracts';
import type { RunUpdate } from '../domain/run-updates';

export async function remoteApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body && typeof options.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${response.status})`);
  }
  return response.json();
}

export type RunObserver = {
  onConnection: (connected: boolean) => void;
  onSnapshot: (run: Run) => void;
  onUpdate: (update: RunUpdate) => void;
};

export function subscribeRemoteRun(id: string, observer: RunObserver) {
  const events = new EventSource(`/api/runs/${id}/events`);
  events.onopen = () => observer.onConnection(true);
  events.onerror = () => observer.onConnection(false);
  events.addEventListener('snapshot', (event) =>
    observer.onSnapshot(JSON.parse((event as MessageEvent).data)),
  );
  events.addEventListener('update', (event) =>
    observer.onUpdate(JSON.parse((event as MessageEvent).data)),
  );
  return () => events.close();
}
