import type { Evidence, Run, Source } from '../../shared/contracts';
import type { RunObserver } from './client';
import {
  applyEvent,
  completeRun,
  eventNodeId,
  publicRun,
  putNode,
  runSummary,
  terminal,
} from '../../shared/evidence.mjs';
import { readLocal, writeLocal, listLocal } from './indexed-db';

type StoredRun = Run & { build: string; events: any[]; commandIds?: string[] };
type Credentials = { model: string; baseURL: string; apiKey: string };
let active: { run: StoredRun; worker: Worker; release: () => void } | undefined;
const unsaved = new Map<string, StoredRun>();
const listeners = new Map<string, Set<RunObserver>>();
let queue = Promise.resolve();
export function lock<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.then(
    () => {},
    () => {},
  );
  return next;
}

const updates =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('ava-notebook-run-updates')
    : undefined;
function deliver(update: { metadata: Omit<Run, 'nodes'>; nodes: Evidence[] }) {
  for (const observer of listeners.get(update.metadata.id) ?? [])
    observer.onUpdate(update);
}
if (updates)
  updates.onmessage = ({ data }) => {
    if (data?.metadata?.id && Array.isArray(data.nodes)) deliver(data);
  };
function notify(run: Run, nodes: Evidence[]) {
  const update = structuredClone({ metadata: runSummary(run), nodes });
  deliver(update);
  updates?.postMessage(update);
}

async function persist(run: StoredRun, nodes: Evidence[] = []) {
  run.revision++;
  run.updatedAt = new Date().toISOString();
  try {
    await writeLocal('runs', run.id, run);
  } catch (error) {
    if (active?.run.id === run.id) active.worker.terminate();
    run.status = 'failed';
    run.error =
      '浏览器保存失败，分析已停止。请检查网站存储空间并导出已有结果。';
    for (const node of run.nodes)
      if (node.status === 'running') node.status = 'failed';
    unsaved.set(run.id, structuredClone(run));
    notify(run, run.nodes);
    throw error;
  }
  notify(run, nodes);
}

const runLockName = (id: string) => `ava-notebook-run:${id}`;

export async function recoverRuns() {
  for (const run of await listLocal<StoredRun>('runs')) {
    if (terminal.has(run.status) || active?.run.id === run.id) continue;
    // A lock held by another tab means the analysis is still alive there.
    if (!navigator.locks) continue;
    await navigator.locks.request(
      runLockName(run.id),
      { ifAvailable: true },
      async (held) => {
        if (!held) return;
        run.status = 'interrupted';
        run.error = '页面曾关闭或刷新，请使用此数据重新分析';
        for (const node of run.nodes)
          if (node.status === 'running') node.status = 'interrupted';
        await persist(run, run.nodes);
      },
    );
  }
}

async function holdRunLock(id: string): Promise<() => void> {
  if (!navigator.locks)
    throw new Error('浏览器不支持安全的分析任务管理，请升级浏览器后重试');
  let release!: () => void;
  const lifetime = new Promise<void>((resolve) => {
    release = resolve;
  });
  await new Promise<void>((resolve, reject) => {
    void navigator.locks
      .request(runLockName(id), { ifAvailable: true }, async (held) => {
        if (!held) {
          reject(new Error('此分析正在另一个页面运行'));
          return;
        }
        resolve();
        await lifetime;
      })
      .catch(reject);
  });
  return release;
}

export function activeRunId() {
  return active?.run.id;
}
export function activeRun(id: string) {
  return structuredClone(active?.run.id === id ? active.run : unsaved.get(id));
}
export function forgetBrowserRun(id: string) {
  unsaved.delete(id);
  listeners.delete(id);
}

export function subscribeBrowserRun(id: string, observer: RunObserver) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(observer);
  let closed = false;
  observer.onConnection(true);
  void lock(async () => {
    const run = activeRun(id) ?? (await readLocal<StoredRun>('runs', id));
    if (!closed && run) observer.onSnapshot(publicRun(run));
  }).catch(() => {
    if (!closed) observer.onConnection(false);
  });
  return () => {
    closed = true;
    listeners.get(id)?.delete(observer);
    if (!listeners.get(id)?.size) listeners.delete(id);
  };
}

export async function startBrowserRun(body: any, llm: Credentials) {
  if (
    typeof body.requestId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(body.requestId)
  )
    throw new Error('无效的请求 ID');
  const previous = await readLocal<StoredRun>('runs', body.requestId);
  if (previous) return publicRun(previous);
  if (active) throw new Error('已有分析正在运行，请先停止当前任务');
  if (!llm.model || !llm.apiKey) throw new Error('请先配置模型名称和 API Key');
  const question =
    typeof body.question === 'string' ? body.question.trim() : '';
  if (
    !question ||
    question.length > 8000 ||
    !['direct', 'loop'].includes(body.strategy)
  )
    throw new Error('请填写有效问题并选择分析模式');
  const stored = await readLocal<{ source: Source; file: File }>(
    'sources',
    body.sourceId,
  );
  if (!stored) throw new Error('未找到 CSV，请重新导入');
  const run: StoredRun = {
    id: body.requestId,
    question,
    source: stored.source,
    strategy: body.strategy,
    model: llm.model,
    build: 'browser-duckdb-wasm',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    revision: 0,
    nodes: [],
    events: [],
  };
  putNode(run, 'source', {
    kind: 'source',
    title: run.source.name,
    status: 'running',
    parents: [],
    payload: run.source,
  });
  run.activeNodeId = 'source';
  const release = await holdRunLock(run.id);
  try {
    await persist(run, run.nodes);
  } catch (error) {
    release();
    throw error;
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (error) {
    release();
    run.status = 'failed';
    run.error = '无法启动浏览器分析引擎';
    for (const node of run.nodes) node.status = 'failed';
    await persist(run, run.nodes);
    throw error;
  }
  const job = { run, worker, release };
  active = job;
  async function message(data: any) {
    if (active !== job || terminal.has(run.status)) return;
    try {
      if (data.type === 'event') {
        const event = {
          ...data.event,
          sequence: run.events.length,
          at: new Date().toISOString(),
          nodeId: eventNodeId(data.event),
        };
        run.events.push(event);
        await persist(run, applyEvent(run, event));
      } else if (data.type === 'context') {
        const existing = run.nodes.find((node) => node.id === 'context');
        const node = putNode(run, 'context', {
          kind: 'context',
          title: '结构与数据质量',
          status: 'succeeded',
          parents: ['source'],
          payload: { ...existing?.payload, ...data.data },
        });
        await persist(run, [node]);
      } else if (data.type === 'done') {
        await persist(run, [completeRun(run, data.result)]);
      } else if (data.type === 'failed') {
        run.status = 'failed';
        run.error = String(
          data.error?.message || '分析失败，请检查模型接口和浏览器跨域配置',
        );
        const changed = run.nodes.filter((node) => node.status === 'running');
        for (const node of changed) node.status = 'failed';
        await persist(run, changed);
      }
    } catch (error: any) {
      if (!terminal.has(run.status)) {
        run.status = 'failed';
        run.error = String(error.message);
        for (const node of run.nodes)
          if (node.status === 'running') node.status = 'failed';
        await persist(run, run.nodes).catch(() => {});
      }
    } finally {
      if (terminal.has(run.status)) {
        worker.terminate();
        release();
        if (active === job) active = undefined;
      }
    }
  }
  worker.onmessage = ({ data }) => {
    void lock(() => message(data));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    void lock(() =>
      message({
        type: 'failed',
        error: { message: '浏览器分析引擎加载失败，请检查网络后重试' },
      }),
    );
  };
  worker.postMessage({
    file: stored.file,
    question,
    strategy: run.strategy,
    llm,
  });
  return publicRun(run);
}

export async function stopBrowserRun(id: string, requestId?: string) {
  const previous = activeRun(id) ?? (await readLocal<StoredRun>('runs', id));
  if (requestId && previous?.commandIds?.includes(requestId))
    return publicRun(previous);
  if (!active || active.run.id !== id)
    throw new Error(
      previous?.status === 'running'
        ? '此分析正在另一个页面运行，请在该页面停止'
        : '任务未在运行',
    );
  const { run, worker, release } = active;
  worker.terminate();
  run.status = 'cancelled';
  if (requestId)
    run.commandIds = [...(run.commandIds ?? []), requestId].slice(-500);
  const changed = run.nodes.filter((node) => node.status === 'running');
  for (const node of changed) node.status = 'cancelled';
  try {
    await persist(run, changed);
  } finally {
    active = undefined;
    release();
  }
  return publicRun(run);
}

export async function saveBrowserRun(run: Run) {
  if (active?.run.id === run.id) Object.assign(active.run, run);
  await writeLocal('runs', run.id, run);
  notify(run, run.nodes);
}

export async function assertBrowserRunMutable(id: string) {
  if (active?.run.id === id || !navigator.locks) return;
  await navigator.locks.request(
    runLockName(id),
    { ifAvailable: true },
    async (held) => {
      if (!held) throw new Error('此分析正在另一个页面运行，请在该页面操作');
    },
  );
}

export function mutateBrowserRun<T>(
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks) return operation();
  return navigator.locks.request(`${runLockName(id)}:mutation`, async () => {
    await assertBrowserRunMutable(id);
    return operation();
  });
}
