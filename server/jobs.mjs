import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveRun, readRun, listRuns, deleteRun, readSource, root } from './store.mjs';
import {
  putNode,
  completeRun,
  applyEvent,
  eventNodeId,
  runSummary,
  terminal,
} from './evidence.mjs';
const require = createRequire(import.meta.url);
const safeError = (error) => {
  let message = String(error?.message || error);
  if (process.env.OPENAI_API_KEY)
    message = message.split(process.env.OPENAI_API_KEY).join('[redacted]');
  return message.slice(0, 3000);
};
export async function buildIdentity() {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.js')) hash.update(await readFile(path));
    }
  }
  await walk(dirname(require.resolve('@antv/ava')));
  return hash.digest('hex');
}
export const modelInfo = () => ({
  model: process.env.OPENAI_MODEL || '',
  configured: Boolean(process.env.OPENAI_MODEL && process.env.OPENAI_API_KEY),
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});
export class Jobs {
  constructor(build) {
    this.build = build;
    this.active = null;
    this.listeners = new Map();
    this.unsaved = new Map();
    this.queue = Promise.resolve();
  }
  lock(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async initialize() {
    for (const run of await listRuns())
      if (!terminal.has(run.status)) {
        run.status = 'interrupted';
        run.error = '本地服务曾停止，请使用此数据重新分析';
        for (const node of run.nodes)
          if (node.status === 'running') node.status = 'interrupted';
        await saveRun(run);
      }
  }
  async get(id) {
    return (
      this.unsaved.get(id) ||
      (this.active?.run.id === id ? this.active.run : readRun(id))
    );
  }
  async remove(id) {
    const run = await this.get(id).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!run) return;
    if (run.caseStudy) throw new Error('经典案例不能删除');
    if (this.active?.run.id === id && !terminal.has(run.status))
      await this.command(id, {});
    await deleteRun(id);
    this.unsaved.delete(id);
    if (this.active?.run.id === id) this.active = null;
    this.listeners.delete(id);
  }
  async persist(run, nodes = []) {
    run.revision++;
    run.updatedAt = new Date().toISOString();
    try {
      await saveRun(run);
    } catch (error) {
      run.status = 'failed';
      run.error = `保存失败：${error.message}。执行已停止，请检查本地磁盘。`;
      run.persistenceFailed = true;
      this.unsaved.set(run.id, run);
      if (this.active?.run.id === run.id) this.active.child.kill('SIGKILL');
      for (const listener of this.listeners.get(run.id) || [])
        listener({ metadata: runSummary(run), nodes: [] });
      throw new Error(run.error);
    }
    const data = { metadata: runSummary(run), nodes };
    for (const listener of this.listeners.get(run.id) || []) listener(data);
  }
  async start({ sourceId, question, requestId, strategy = 'direct' }) {
    if (requestId) {
      try {
        return await readRun(requestId);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if ((await buildIdentity()) !== this.build)
      throw new Error('AVA 构建已变化，请重启 Notebook 服务');
    if (this.active) throw new Error('已有分析正在运行，请先停止当前任务');
    if (!modelInfo().configured) throw new Error('请先配置模型名称和 API Key');
    const { source, path } = await readSource(sourceId);
    const run = {
      id: requestId || randomUUID(),
      question,
      source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      strategy,
      revision: 0,
      commandIds: [],
      nodes: [],
      events: [],
      build: this.build,
      model: modelInfo().model,
    };
    putNode(run, 'source', {
      kind: 'source',
      title: source.name,
      status: 'running',
      payload: source,
      parents: [],
    });
    run.activeNodeId = 'source';
    await this.persist(run, run.nodes);
    const scratch = join(root, 'scratch', run.id);
    await mkdir(scratch, { recursive: true });
    const child = fork(
      fileURLToPath(new URL('./worker.mjs', import.meta.url)),
      [],
      {
        env: { ...process.env, TMPDIR: scratch },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    const job = {
      run,
      child,
      scratch,
    };
    this.active = job;
    child.stderr.on('data', () => {});
    child.on('error', (error) => {
      void this.lock(() => this.fail(job, safeError(error))).catch(() => {});
    });
    child.on('message', (message) => {
      void this.lock(() => this.message(job, message)).catch(async (error) => {
        await this.fail(job, safeError(error)).catch(() => {});
      });
    });
    child.on('exit', () => {
      void this.lock(async () => {
        if (!terminal.has(run.status)) {
          run.status = 'interrupted';
          run.error = '执行进程已退出，请重新分析';
          const nodes = run.nodes.filter((node) => node.status === 'running');
          for (const node of nodes) node.status = 'interrupted';
          await this.persist(run, nodes);
        }
        if (this.active === job) this.active = null;
        await rm(scratch, { recursive: true, force: true });
      }).catch(() => {});
    });
    child.send({
      type: 'start',
      sourcePath: path,
      semantic: source.semantic?.definition,
      question,
      strategy,
      scratch,
    });
    return run;
  }
  async fail(job, error) {
    const detail = { name: error?.name, message: safeError(error) };
    if (error?.name === 'AI_NoObjectGeneratedError') {
      if (typeof error.text === 'string')
        detail.responseText = safeError(error.text);
      if (typeof error.finishReason === 'string')
        detail.finishReason = error.finishReason;
    }
    if (!terminal.has(job.run.status)) {
      job.run.status = 'failed';
      const node = job.run.nodes.find((n) => n.id === job.run.activeNodeId);
      job.run.error =
        detail.name === 'AI_NoObjectGeneratedError' && node?.kind === 'summary'
          ? '模型总结未符合所需格式；SQL 和查询结果已保留。'
          : detail.message;
      if (node && ['running', 'failed'].includes(node.status)) {
        node.status = 'failed';
        node.payload.error = { ...node.payload.error, ...detail };
      }
      const changed = job.run.nodes.filter((item) => item.status === 'running');
      for (const item of changed) item.status = 'failed';
      await this.persist(job.run, [
        ...new Set([...changed, ...(node ? [node] : [])]),
      ]);
    }
    job.child.kill('SIGKILL');
  }
  async message(job, message) {
    if (this.active !== job || terminal.has(job.run.status)) return;
    const run = job.run;
    if (message.type === 'context') {
      const node = putNode(run, 'context', {
        kind: 'context',
        title: '结构与数据质量',
        status: 'succeeded',
        parents: ['source'],
        payload: {
          ...run.nodes.find((n) => n.id === 'context')?.payload,
          ...message.data,
        },
      });
      await this.persist(run, [node]);
    } else if (message.type === 'event') {
      const event = {
        ...message.event,
        sequence: run.events.length,
        at: new Date().toISOString(),
        nodeId: eventNodeId(message.event),
      };
      if (event.data?.error) {
        event.data = {
          ...event.data,
          error: {
            name: event.data.error.name,
            message: safeError(event.data.error),
          },
        };
      }
      run.events.push(event);
      const changed = applyEvent(run, event);
      if (changed.length) await this.persist(run, changed);
    } else if (message.type === 'done') {
      const node = completeRun(run, message.result);
      await this.persist(run, [node]);
    } else if (message.type === 'failed') await this.fail(job, message.error);
  }
  async command(id, { requestId }) {
    const current = await this.get(id);
    if (requestId && current.commandIds?.includes(requestId)) return current;
    const job = this.active;
    if (!job || job.run.id !== id || terminal.has(job.run.status))
      throw new Error('任务未在运行');
    if (requestId)
      job.run.commandIds = [...job.run.commandIds, requestId].slice(-500);
    job.run.status = 'cancelled';
    const nodes = job.run.nodes.filter((node) => node.status === 'running');
    for (const node of nodes) node.status = 'cancelled';
    await this.persist(job.run, nodes);
    job.child.kill('SIGKILL');
    return job.run;
  }
  async shutdown() {
    if (this.active) {
      const job = this.active;
      if (!terminal.has(job.run.status)) {
        job.run.status = 'interrupted';
        const nodes = job.run.nodes.filter((node) => node.status === 'running');
        for (const node of nodes) node.status = 'interrupted';
        await this.persist(job.run, nodes);
      }
      job.child.kill('SIGKILL');
    }
  }
}
