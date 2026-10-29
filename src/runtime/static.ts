import type { Run, Session, Source } from '../../shared/contracts';
import { readLocal, listLocal, writeLocal, deleteLocal } from './indexed-db';
import { chartPreview, evidenceDatasets } from '../domain/evidence';

let model = '';
let baseURL = 'https://api.openai.com/v1';
let apiKey = '';
const session = (): Session => ({
  model,
  baseURL,
  configured: !!(model && apiKey),
  build: '',
});

async function classicCases(): Promise<Run[]> {
  return (await import('../../examples/classic/generated/cases.json'))
    .default as unknown as Run[];
}

async function readRun(id: string) {
  return (
    (await readLocal<Run>('runs', id)) ||
    structuredClone((await classicCases()).find((run) => run.id === id))
  );
}

export async function readCSV(file: File): Promise<Source> {
  if (!/\.csv$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error('请上传 1 字节至 10 MB 的 CSV 文件');
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('CSV 必须是 UTF-8 文本');
  const { parse } = await import('csv-parse/browser/esm/sync');
  let count = 0;
  const records = parse(text, {
    bom: true,
    skip_empty_lines: true,
    max_record_size: 1024 * 1024,
    on_record(record: string[]) {
      if (++count > 100001) throw new Error('一期最多支持 100,000 行数据');
      return count <= 6 ? record : null;
    },
  }) as string[][];
  const headers = records[0];
  if (
    count < 2 ||
    !headers?.length ||
    headers.some((name) => !name.trim()) ||
    new Set(headers).size !== headers.length
  )
    throw new Error('CSV 需包含唯一非空表头和至少一行数据');
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const source: Source = {
    id: crypto.randomUUID(),
    name: file.name,
    bytes: file.size,
    hash,
    headers,
    rows: count - 1,
    preview: records
      .slice(1)
      .map((row) =>
        Object.fromEntries(headers.map((name, i) => [name, row[i]])),
      ),
  };
  return source;
}

// shortcut: Static builds replay saved analyses; connect a browser query engine before enabling execution.
export async function browserApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method || 'GET';
  let result: unknown;
  if (method === 'GET' && path === '/session') result = session();
  else if (method === 'GET' && path === '/runs') {
    const saved = await listLocal<Run>('runs');
    const ids = new Set(saved.map((run) => run.id));
    result = [
      ...saved,
      ...(await classicCases()).filter((run) => !ids.has(run.id)),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } else if (method === 'POST' && path === '/settings') {
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
    model = settings.model.trim();
    baseURL = settings.baseURL;
    if (settings.apiKey) apiKey = settings.apiKey;
    result = session();
  } else if (
    method === 'POST' &&
    path === '/sources' &&
    options.body instanceof File
  ) {
    const source = await readCSV(options.body);
    await writeLocal('sources', source.id, { source, file: options.body });
    result = source;
  } else if (method === 'GET' && /^\/runs\/[^/]+$/.test(path)) {
    result = await readRun(path.split('/')[2]);
    if (!result) throw new Error('未找到这份分析记录');
  } else if (method === 'DELETE' && /^\/runs\/[^/]+$/.test(path)) {
    const id = path.split('/')[2];
    const run = await readRun(id);
    if (run?.caseStudy) throw new Error('经典案例不能删除');
    await deleteLocal('runs', id);
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
    await writeLocal('runs', run.id, run);
    result = run;
  } else throw new Error('查询引擎尚未接入');
  return result as T;
}
