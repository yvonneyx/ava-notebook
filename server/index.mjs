import { createApp } from './app.mjs';
import { modelInfo } from './analysis/jobs.mjs';

const port = Number(process.env.PORT || 4317);
const app = await createApp({ port, dev: process.argv.includes('--dev') });
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
    await app.close();
    process.exit(0);
  });
