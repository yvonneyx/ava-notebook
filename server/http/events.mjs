import { publicRun } from '../analysis/evidence.mjs';

export function registerEvents(app, jobs) {
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
}
