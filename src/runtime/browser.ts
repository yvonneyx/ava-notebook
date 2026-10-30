import type { Run, Session, Source } from '../../shared/contracts';
import {
  readLocal,
  listLocal,
  writeLocal,
  deleteLocal,
  archiveLocalRun,
} from './indexed-db';
import {
  activeRun,
  activeRunId,
  lock,
  recoverRuns,
  startBrowserRun,
  stopBrowserRun,
  saveBrowserRun,
  forgetBrowserRun,
  mutateBrowserRun,
} from './browser-jobs';
import { publicRun, runSummary } from '../../shared/evidence.mjs';
import { chartPreview, evidenceDatasets } from '../domain/evidence';

let model = '';
let baseURL = 'https://api.openai.com/v1';
let apiKey = '';
async function loadSettings() {
  const saved = await readLocal<{ model: string; baseURL: string; apiKey: string }>(
    'drafts',
    'model-settings',
  );
  if (saved) ({ model, baseURL, apiKey } = saved);
}
const session = (): Session => ({
  model,
  baseURL,
  configured: !!(model && apiKey),
  build: 'browser-duckdb-wasm',
  activeRunId: activeRunId(),
});

async function classicCases(): Promise<Run[]> {
  const cases = (await import('../../examples/classic/generated/cases.json'))
    .default as unknown as Run[];
  return cases;
}

async function refreshClassicCopies() {
  for (const current of await classicCases()) {
    await mutateBrowserRun(current.id, async () => {
      const saved = await readLocal<Run>('runs', current.id);
      if (!saved?.caseStudy || saved.createdAt === current.createdAt) return;
      // Keep personal charts on the old snapshot while showing the newly generated case.
      const { caseStudy, ...archive } = saved;
      archive.id = crypto.randomUUID();
      await archiveLocalRun(saved.id, archive);
    });
  }
}

async function readRun(id: string) {
  const cases = await classicCases();
  return (
    activeRun(id) ||
    (await readLocal<Run>('runs', id)) ||
    structuredClone(cases.find((run) => run.id === id))
  );
}

async function importCSV(file: File): Promise<Source> {
  const worker = new Worker(new URL('./csv.worker.ts', import.meta.url), {
    type: 'module',
  });
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await new Promise<Source>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('CSV 读取超时，请检查网络后重试')),
        60000,
      );
      worker.onmessage = ({ data }) =>
        data.error ? reject(new Error(data.error)) : resolve(data.source);
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error('CSV 读取失败，请重新导入'));
      };
      worker.postMessage(file);
    });
  } finally {
    clearTimeout(timeout!);
    worker.terminate();
  }
}

async function handleBrowserApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method || 'GET';
  let result: unknown;
  if (method === 'GET' && path === '/session') {
    await loadSettings();
    await recoverRuns();
    result = session();
  } else if (method === 'GET' && path === '/runs') {
    const cases = await classicCases();
    const saved = (await listLocal<Run>('runs')).map(
      (run) => activeRun(run.id) ?? run,
    );
    const ids = new Set(saved.map((run) => run.id));
    result = [...saved, ...cases.filter((run) => !ids.has(run.id))]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(runSummary);
  } else if (method === 'POST' && path === '/runs') {
    await loadSettings();
    result = await startBrowserRun(JSON.parse(String(options.body)), {
      model,
      baseURL,
      apiKey,
    });
  } else if (method === 'POST' && /^\/runs\/[^/]+\/control$/.test(path)) {
    const body = JSON.parse(String(options.body));
    if (body.command !== 'stop') throw new Error('无效操作');
    result = await stopBrowserRun(path.split('/')[2], body.requestId);
  } else if (method === 'POST' && path === '/settings') {
    if (activeRunId()) throw new Error('请先停止当前分析，再修改模型配置');
    const settings = JSON.parse(String(options.body));
    const url = new URL(settings.baseURL);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('模型地址须为不含凭证或查询参数的 HTTP(S) URL');
    if (!settings.model?.trim()) throw new Error('请填写模型名称');
    await loadSettings();
    const next = {
      model: settings.model.trim(),
      baseURL: settings.baseURL,
      apiKey: settings.apiKey || apiKey,
    };
    await writeLocal('drafts', 'model-settings', next);
    ({ model, baseURL, apiKey } = next);
    result = session();
  } else if (
    method === 'POST' &&
    path === '/sources' &&
    options.body instanceof File
  ) {
    const source = await importCSV(options.body);
    await writeLocal('sources', source.id, { source, file: options.body });
    result = source;
  } else if (method === 'GET' && /^\/runs\/[^/]+$/.test(path)) {
    result = await readRun(path.split('/')[2]);
    if (!result) throw new Error('未找到这份分析记录');
    result = publicRun(result as Run);
  } else if (method === 'GET' && /^\/runs\/[^/]+\/export$/.test(path)) {
    const run = await readRun(path.split('/')[2]);
    if (!run) throw new Error('未找到这份分析记录');
    result = {
      format: 'ava-notebook-evidence',
      version: 1,
      exportedAt: new Date().toISOString(),
      run,
    };
  } else if (method === 'DELETE' && /^\/runs\/[^/]+$/.test(path)) {
    const id = path.split('/')[2];
    const run = await readRun(id);
    if (run?.caseStudy) throw new Error('经典案例不能删除');
    if (activeRunId() === id) await stopBrowserRun(id);
    await deleteLocal('runs', id);
    forgetBrowserRun(id);
    result = { ok: true };
  } else if (method === 'POST' && /^\/runs\/[^/]+\/charts$/.test(path)) {
    const run = await readRun(path.split('/')[2]);
    if (!run) throw new Error('未找到这份分析记录');
    const { nodeId, x, y } = JSON.parse(String(options.body));
    const node = run.nodes.find(
      (item) => item.id === nodeId && item.kind === 'result',
    );
    if (!node) throw new Error('请选择有效的查询结果');
    const dataset = evidenceDatasets(run, node)[0];
    if (!dataset.columns.includes(x) || !dataset.columns.includes(y))
      throw new Error('请选择有效的结果列');
    const chart = chartPreview(dataset, x, y);
    if (!chart.canSave) throw new Error('数值列必须包含有效数字');
    run.nodes.push({
      id: `chart-${crypto.randomUUID()}`,
      sequence: Math.max(...run.nodes.map((item) => item.sequence)) + 1,
      kind: 'chart',
      stepId: node.stepId,
      title: `${y} · 按 ${x}`,
      status: 'succeeded',
      parents: [nodeId],
      payload: { nodeId, x, y, rows: chart.rows, truncated: chart.limited },
    });
    run.revision++;
    run.updatedAt = new Date().toISOString();
    run.nodeCount = run.nodes.length;
    await saveBrowserRun(run);
    result = publicRun(run);
  } else throw new Error('不支持的浏览器操作');
  return result as T;
}

export function browserApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return lock(async () => {
    await refreshClassicCopies();
    const id = path.split('/')[2];
    if (
      (options.method === 'DELETE' && /^\/runs\/[^/]+$/.test(path)) ||
      (options.method === 'POST' && /^\/runs\/[^/]+\/charts$/.test(path))
    ) {
      return mutateBrowserRun(id, () => handleBrowserApi<T>(path, options));
    }
    return handleBrowserApi<T>(path, options);
  });
}
