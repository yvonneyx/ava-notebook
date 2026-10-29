import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  saveRun,
  readRun,
  listRuns,
  readSource,
  saveCheckpoint,
  readCheckpoint,
  root,
  digest,
} from './store.mjs';
import {
  putNode,
  applyEvent,
  checkpointId,
  forkPrefix,
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
const signature = () =>
  digest(
    JSON.stringify({ model: modelInfo().model, url: modelInfo().baseURL }),
  );
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
        run.error = '本地服务曾停止，请从检查点创建分支继续';
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
  async start({
    sourceId,
    question,
    mode,
    parentId,
    nodeId,
    sql,
    instruction,
    requestId,
  }) {
    if (requestId) {
      try {
        return await readRun(requestId);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if ((await buildIdentity()) !== this.build)
      throw new Error('AVA 构建已变化，请重启 Notebook 服务');
    if (this.active)
      throw new Error('已有分析正在运行或暂停，请先停止当前任务');
    if (!modelInfo().configured) throw new Error('请先配置模型名称和 API Key');
    let resume,
      parent,
      prefix = [];
    if (parentId) {
      parent = await readRun(parentId);
      if (parent.build !== this.build || parent.modelSignature !== signature())
        throw new Error('AVA 构建或模型配置已变化，请使用此 CSV 开始新的分析');
      resume = await readCheckpoint(parent, nodeId);
      prefix = forkPrefix(parent, nodeId);
      sourceId = parent.source.id;
      question = parent.question;
    }
    const { source, path } = await readSource(sourceId);
    const run = {
      id: requestId || randomUUID(),
      question,
      source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      mode: mode || 'auto',
      revision: 0,
      commandIds: [],
      nodes: prefix,
      events: [],
      build: this.build,
      model: modelInfo().model,
      modelSignature: signature(),
      parentId,
      forkNodeId: nodeId,
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
      gate: null,
      pauseRequested: false,
      initialDecision: sql || instruction ? { sql, instruction } : null,
    };
    this.active = job;
    child.stderr.on('data', () => {});
    child.on('error', (error) => {
      void this.lock(() => this.fail(job, safeError(error))).catch(() => {});
    });
    child.on('message', (message) => {
      void this.lock(() => this.message(job, message)).catch(async (error) => {
        if (message.id && child.connected)
          child.send({
            type: 'reply',
            id: message.id,
            error: safeError(error),
          });
        await this.fail(job, safeError(error)).catch(() => {});
      });
    });
    child.on('exit', () => {
      void this.lock(async () => {
        if (!terminal.has(run.status)) {
          run.status = 'interrupted';
          run.error = '执行进程已退出，请从检查点重试';
          await this.persist(run);
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
      resume,
      scratch,
    });
    return run;
  }
  async fail(job, error) {
    error = safeError(error);
    if (!terminal.has(job.run.status)) {
      job.run.status = 'failed';
      job.run.error = error;
      const node = job.run.nodes.find((n) => n.id === job.run.activeNodeId);
      if (node && ['running', 'ready', 'paused'].includes(node.status)) {
        node.status = 'failed';
        node.payload.error = { message: error };
      }
      await this.persist(job.run, node ? [node] : []);
    }
    job.child.kill('SIGKILL');
  }
  async message(job, message) {
    if (this.active !== job || terminal.has(job.run.status)) return;
    const run = job.run;
    if (message.type === 'checkpoint') {
      await saveCheckpoint(run, 'current', message.state);
      const key = checkpointId(message.state);
      if (run.nodes.find((n) => n.id === key)?.checkpoint)
        await saveCheckpoint(run, key, message.state);
      job.child.send({ type: 'reply', id: message.id });
    } else if (message.type === 'ready') {
      await saveCheckpoint(
        run,
        message.state.phase === 'model'
          ? `m-${message.state.step}`
          : message.state.phase === 'query'
          ? `q-${message.state.step}-${message.state.pending.index}`
          : 'conclusion',
        message.state,
      );
      const node = run.nodes.find((n) => n.id === run.activeNodeId);
      if (!node)
        throw new Error('AVA telemetry did not announce the pending step');
      node.checkpoint = node.id;
      const pause =
        job.pauseRequested ||
        run.mode === 'step' ||
        (run.mode === 'query' && message.state.phase === 'query');
      job.gate = { requestId: message.id, state: message.state };
      if (pause) {
        run.status = 'paused';
        node.status = 'paused';
        await this.persist(run, [node]);
      } else await this.release(job, job.initialDecision || {});
    } else if (message.type === 'event') {
      const event = {
        ...message.event,
        sequence: run.events.length,
        at: new Date().toISOString(),
        nodeId: run.activeNodeId,
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
    } else if (message.type === 'usage') {
      const node = run.nodes.find((n) => n.id === run.activeNodeId);
      if (node) {
        node.payload.usage = message.usage;
        await this.persist(run, [node]);
      }
    } else if (message.type === 'done') {
      run.status = 'completed';
      run.result = message.result;
      const node = putNode(run, 'conclusion', {
        status: 'succeeded',
        payload: { ...message.result },
      });
      await this.persist(run, [node]);
    } else if (message.type === 'failed') {
      if (message.cancelled) {
        run.status = 'cancelled';
        await this.persist(run);
      } else await this.fail(job, message.error);
    }
  }
  async release(job, decision) {
    if (!job.gate) throw new Error('当前没有可继续的检查点');
    const node = job.run.nodes.find((n) => n.id === job.run.activeNodeId);
    const actual = { ...(job.initialDecision || {}), ...decision };
    job.initialDecision = null;
    if (actual.sql && job.gate.state.phase !== 'query')
      throw new Error('只能在查询前修改 SQL');
    if (actual.sql || actual.instruction) {
      job.run.events.push({
        type: 'intervention',
        at: new Date().toISOString(),
        nodeId: node.id,
        data: actual,
      });
      node.payload.interventions = [
        ...(node.payload.interventions || []),
        actual,
      ];
      if (actual.sql) {
        node.payload.originalSQL ??= node.payload.sql;
        node.payload.sql = actual.sql;
      }
    }
    job.pauseRequested = false;
    job.run.status = 'running';
    node.status = 'running';
    await this.persist(job.run, [node]);
    job.child.send({ type: 'reply', id: job.gate.requestId, value: actual });
    job.gate = null;
  }
  async command(
    id,
    { command, mode, sql, instruction, revision, requestId, nodeId },
  ) {
    const current = await this.get(id);
    if (requestId && current.commandIds?.includes(requestId)) return current;
    const job = this.active;
    if (!job || job.run.id !== id)
      throw new Error('任务未在运行，请从历史检查点创建分支');
    if (revision !== undefined && job.run.revision !== revision)
      throw new Error('任务状态已变化，请刷新后操作');
    if (
      command === 'continue' &&
      (!job.gate || (nodeId && job.run.activeNodeId !== nodeId))
    )
      throw new Error('执行节点已变化，请检查最新状态');
    if (command === 'continue' && sql && job.gate.state.phase !== 'query')
      throw new Error('只能在查询前修改 SQL');
    if (
      command === 'continue' &&
      instruction &&
      job.gate.state.phase === 'complete'
    )
      throw new Error('请从前面的分析或查询节点创建分支以补充要求');
    if (requestId)
      job.run.commandIds = [...(job.run.commandIds || []), requestId].slice(
        -500,
      );
    if (mode) job.run.mode = mode;
    if (command === 'stop') {
      job.run.status = 'cancelled';
      const node = job.run.nodes.find((n) => n.id === job.run.activeNodeId);
      if (node && ['running', 'ready', 'paused'].includes(node.status))
        node.status = 'cancelled';
      await this.persist(job.run, node ? [node] : []);
      job.child.send({ type: 'cancel' });
      const timer = setTimeout(() => {
        if (job.child.exitCode === null) job.child.kill('SIGKILL');
      }, 1500);
      timer.unref();
    } else if (command === 'pause') {
      job.pauseRequested = true;
      if (job.run.status !== 'paused') job.run.status = 'pausing';
      await this.persist(job.run);
    } else if (command === 'continue')
      await this.release(job, {
        ...(sql ? { sql } : {}),
        ...(instruction ? { instruction } : {}),
      });
    else await this.persist(job.run);
    return job.run;
  }
  async shutdown() {
    if (this.active) {
      const job = this.active;
      if (!terminal.has(job.run.status)) {
        job.run.status = 'interrupted';
        await this.persist(job.run);
      }
      job.child.kill('SIGKILL');
    }
  }
}
