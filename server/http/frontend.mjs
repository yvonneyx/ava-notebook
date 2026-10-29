import fastifyStatic from '@fastify/static';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function registerFrontend(app, dev) {
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
  return vite;
}
