export const browserMode = import.meta.env.MODE === 'static';

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (browserMode) {
    const { browserApi } = await import('./browser-api');
    return browserApi<T>(path, options);
  }
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
export const post = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
