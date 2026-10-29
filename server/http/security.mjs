import { z } from 'zod';

export function registerSecurity(app, { port, token }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
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
        ? error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')
        : error.message;
    if (process.env.OPENAI_API_KEY)
      message = message.split(process.env.OPENAI_API_KEY).join('[redacted]');
    reply
      .code(error.statusCode || (error.code === 'ENOENT' ? 404 : 400))
      .send({ error: message });
  });
}
