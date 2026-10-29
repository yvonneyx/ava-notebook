import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
const { AVA } = createRequire(import.meta.url)('@antv/ava');
const send = (message) =>
  new Promise((resolve, reject) =>
    process.send(message, (error) => (error ? reject(error) : resolve())),
  );
process.on('message', (message) => {
  if (message.type === 'start') void execute(message);
});
process.on('disconnect', () => process.exit(0));

async function execute({ sourcePath, semantic, question, strategy, scratch }) {
  const ava = new AVA({
    llm: {
      model: process.env.OPENAI_MODEL,
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      maxRetries: 1,
    },
    engine: {
      type: 'duckdb',
      queryTimeoutMs: 30000,
      memoryLimit: '512MB',
      maxTempDirectorySize: '512MB',
    },
  });
  let failed = false;
  ava.on('*', (event) => {
    void send({ type: 'event', event }).catch(() => {});
  });
  try {
    await ava.source({ type: 'csv-file', options: { path: sourcePath } });
    await send({ type: 'context', data: { schema: await ava.schema() } });
    if (semantic)
      await send({
        type: 'context',
        data: { semantic: await ava.semantic(undefined, () => semantic) },
      });
    await send({
      type: 'context',
      data: {
        profile: await ava.profile({ metrics: ['row_count', 'null_count'] }),
      },
    });
    const result = await ava.analyze(question, {
      maxRows: 200,
      maxResultBytes: 1024 * 1024,
      strategy: { type: strategy },
    });
    await send({ type: 'done', result });
  } catch (error) {
    failed = true;
    await send({
      type: 'failed',
      error: {
        name: error.name,
        message: error.message,
        ...(error.name === 'AI_NoObjectGeneratedError'
          ? { text: error.text, finishReason: error.finishReason }
          : {}),
      },
    }).catch(() => {});
  } finally {
    await ava.dispose().catch(() => {});
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
    process.exit(failed ? 1 : 0);
  }
}
