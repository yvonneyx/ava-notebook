import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { modelInfo } from '../analysis/jobs.mjs';
import { createSource, listRuns } from '../storage/index.mjs';
import { putNode, runSummary, publicRun } from '../analysis/evidence.mjs';
import { loadSalesExample } from '../examples/sales.mjs';

export function registerRoutes(app, { jobs, token }) {
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
    (await listRuns()).map((run) =>
      runSummary(jobs.unsaved.get(run.id) || run),
    ),
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
        .map((row) => ({
          label: String(row[body.x] ?? ''),
          value: row[body.y],
        }));
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
          truncated:
            source.payload.truncated || source.payload.data.length > 20,
        },
      });
      await jobs.persist(run, [node]);
      return publicRun(run);
    }),
  );
}
