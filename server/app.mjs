import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { Jobs, buildIdentity } from './analysis/jobs.mjs';
import { initializeStore, closeStore } from './storage/index.mjs';
import { seedClassicCases } from './examples/seed.mjs';
import { registerSecurity } from './http/security.mjs';
import { registerRoutes } from './http/routes.mjs';
import { registerEvents } from './http/events.mjs';
import { registerFrontend } from './http/frontend.mjs';

export async function createApp({ port = 4317, dev = false } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  const token = randomBytes(32).toString('hex');
  await initializeStore();
  await seedClassicCases();
  const jobs = new Jobs(await buildIdentity());
  await jobs.initialize();
  registerSecurity(app, { port, token });
  registerRoutes(app, { jobs, token });
  registerEvents(app, jobs);
  const vite = await registerFrontend(app, dev);
  // Stop analysis workers before closing storage.
  app.addHook('preClose', async () => {
    await jobs.lock(() => jobs.shutdown());
    for (const sockets of jobs.listeners.values()) sockets.clear();
    await vite?.close();
  });
  app.addHook('onClose', closeStore);
  return app;
}
