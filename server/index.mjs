import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Jobs, buildIdentity, modelInfo } from './jobs.mjs';
import {
  createSource,
  listRuns,
  initializeStore,
  closeStore,
} from './store.mjs';
import { putNode, runSummary } from './evidence.mjs';
import { loadSalesExample } from './sales-example.mjs';
import { seedClassicCases } from './classic-cases.mjs';

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || 4317);
const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
const token = randomBytes(32).toString('hex');
await initializeStore();
await seedClassicCases();
app.addHook('onClose', closeStore);
const jobs = new Jobs(await buildIdentity());
await jobs.initialize();
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const publicRun = (run) => ({ ...runSummary(run), nodes: run.nodes });
app.addHook('onRequest', async (request, reply) => {
  if (!allowedHosts.has(request.headers.host))
    return reply.code(403).send({ error: 'Host not allowed' });
  const origin = request.headers.origin;
  if (origin && !allowedHosts.has(new URL(origin).host))
    return reply.code(403).send({ error: 'Origin not allowed' });
  if (request.headers['sec-fetch-site'] === 'cross-site')
    return reply.code(403).send({ error: 'Cross-site request rejected' });
  if (request.url.startsWith('/api/') && request.url !== '/api/session') {
    if (
      !(request.headers.cookie || '')
        .split(';')
        .some((part) => part.trim() === `ava_session=${token}`)
    )
      return reply.code(401).send({ error: '请刷新页面以建立本地会话' });
    reply.header('Cache-Control', 'no-store');
  }
});
app.setErrorHandler((error, _request, reply) => {
  let message =
    error instanceof z.ZodError
      ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : error.message;
  if (process.env.OPENAI_API_KEY)
    message = message.split(process.env.OPENAI_API_KEY).join('[redacted]');
  reply
    .code(error.statusCode || (error.code === 'ENOENT' ? 404 : 400))
    .send({ error: message });
});
app.get('/api/session', async (_request, reply) => {
  reply
    .header('Cache-Control', 'no-store')
    .header(
      'Set-Cookie',
      `ava_session=${token}; HttpOnly; SameSite=Strict; Path=/`,
    );
  return {
    ...modelInfo(),
    build: jobs.build.slice(0, 12),
    activeRunId: jobs.active?.run.id,
  };
});
app.post('/api/settings', async (request) =>
  jobs.lock(async () => {
    if (jobs.active) throw new Error('请先停止当前分析，再修改模型配置');
    const settings = z
      .object({
        model: z.string().trim().min(1).max(200),
        apiKey: z.string().trim().max(4096).optional(),
        baseURL: z.string().url().max(1000),
      })
      .strict()
      .parse(request.body);
    const url = new URL(settings.baseURL);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('模型地址须为不含凭证或查询参数的 HTTP(S) URL');
    if (settings.apiKey) process.env.OPENAI_API_KEY = settings.apiKey;
    process.env.OPENAI_MODEL = settings.model;
    process.env.OPENAI_BASE_URL = settings.baseURL;
    return modelInfo();
  }),
);
app.addContentTypeParser(
  'text/csv',
  { parseAs: 'buffer' },
  (_request, body, done) => done(null, body),
);
app.post('/api/sources', async (request) => {
  if (!Buffer.isBuffer(request.body)) throw new Error('请上传 CSV 文件');
  const name = decodeURIComponent(
    String(request.headers['x-filename'] || 'data.csv'),
  ).slice(0, 180);
  return createSource(request.body, name);
});
app.post('/api/examples/sales', async () => loadSalesExample());
app.get('/api/runs', async () =>
  (await listRuns()).map((run) => runSummary(jobs.unsaved.get(run.id) || run)),
);
app.post('/api/runs', async (request) =>
  jobs.lock(async () => {
    const body = z
      .object({
        sourceId: z.string().uuid(),
        question: z.string().trim().min(1).max(8000),
        strategy: z.enum(['direct', 'loop']).default('direct'),
        requestId: z.string().uuid().optional(),
      })
      .strict()
      .parse(request.body);
    return publicRun(await jobs.start(body));
  }),
);
app.get('/api/runs/:id', async (request) =>
  publicRun(await jobs.get(request.params.id)),
);
app.delete('/api/runs/:id', async (request) =>
  jobs.lock(async () => {
    await jobs.remove(request.params.id);
    return { ok: true };
  }),
);
app.get('/api/runs/:id/export', async (request, reply) => {
  const run = await jobs.get(request.params.id);
  reply.header(
    'Content-Disposition',
    `attachment; filename="ava-evidence-${run.id}.json"`,
  );
  return {
    format: 'ava-notebook-evidence',
    version: 1,
    exportedAt: new Date().toISOString(),
    run,
  };
});
app.post('/api/runs/:id/control', async (request) =>
  jobs.lock(async () => {
    const body = z
      .object({
        command: z.literal('stop'),
        requestId: z.string().uuid().optional(),
      })
      .strict()
      .parse(request.body);
    return publicRun(await jobs.command(request.params.id, body));
  }),
);
app.post('/api/runs/:id/charts', async (request) =>
  jobs.lock(async () => {
    const body = z
      .object({ nodeId: z.string(), x: z.string(), y: z.string() })
      .strict()
      .parse(request.body);
    const run = await jobs.get(request.params.id);
    const source = run.nodes.find(
      (n) => n.id === body.nodeId && n.kind === 'result',
    );
    if (
      !source ||
      !source.payload.schema.some((c) => c.name === body.x) ||
      !source.payload.schema.some((c) => c.name === body.y)
    )
      throw new Error('请选择有效的结果列');
    const rows = source.payload.data
      .slice(0, 20)
      .map((row) => ({ label: String(row[body.x] ?? ''), value: row[body.y] }));
    if (
      !rows.length ||
      rows.some(
        (row) => typeof row.value !== 'number' || !Number.isFinite(row.value),
      )
    )
      throw new Error('数值列必须包含有效数字');
    const node = putNode(run, `chart-${randomUUID()}`, {
      kind: 'chart',
      stepId: source.stepId,
      title: `${body.y} · 按 ${body.x}`,
      status: 'succeeded',
      parents: [body.nodeId],
      payload: {
        ...body,
        rows,
        truncated: source.payload.truncated || source.payload.data.length > 20,
      },
    });
    await jobs.persist(run, [node]);
    return publicRun(run);
  }),
);
app.get('/api/runs/:id/events', async (request, reply) => {
  const run = await jobs.get(request.params.id);
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event, data, id) => {
    if (reply.raw.writableLength > 2 * 1024 * 1024) {
      reply.raw.end();
      return;
    }
    if (!reply.raw.destroyed && !reply.raw.writableEnded)
      reply.raw.write(
        `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      );
  };
  emit('snapshot', publicRun(run), run.revision);
  const listener = (data) => emit('update', data, data.metadata.revision);
  if (!jobs.listeners.has(run.id)) jobs.listeners.set(run.id, new Set());
  jobs.listeners.get(run.id).add(listener);
  const heartbeat = setInterval(() => {
    if (!reply.raw.destroyed && !reply.raw.writableEnded)
      reply.raw.write(': heartbeat\n\n');
  }, 15000);
  request.raw.on('close', () => {
    clearInterval(heartbeat);
    jobs.listeners.get(run.id)?.delete(listener);
  });
});
let vite;
if (dev) {
  vite = await (
    await import('vite')
  ).createServer({
    server: { middlewareMode: true, hmr: { server: app.server } },
    appType: 'custom',
  });
  app.get('/*', (request, reply) => {
    reply.hijack();
    vite.middlewares(request.raw, reply.raw, async () => {
      try {
        const html = await vite.transformIndexHtml(
          request.url,
          await readFile(resolve('index.html'), 'utf8'),
        );
        reply.raw.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
        });
        reply.raw.end(html);
      } catch (error) {
        reply.raw.writeHead(500);
        reply.raw.end('Development server error');
      }
    });
  });
} else {
  await app.register(fastifyStatic, { root: resolve('dist') });
  app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));
}
await app.listen({ port, host: '127.0.0.1' });
console.log(`AVA Notebook: http://127.0.0.1:${port}`);
console.log(
  `Model: ${modelInfo().model || 'not configured'}; API key: ${
    modelInfo().configured ? 'configured' : 'not configured'
  }`,
);
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await jobs.lock(() => jobs.shutdown());
    for (const sockets of jobs.listeners.values()) sockets.clear();
    await vite?.close();
    await app.close();
    process.exit(0);
  });
