import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { AVA } = require('@antv/ava');
let nextId = 0;
const pending = new Map();
const abort = new AbortController();
const send = (message) =>
  new Promise((resolve, reject) =>
    process.send(message, (error) => (error ? reject(error) : resolve())),
  );
const request = (type, state) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send({ type, id, state }).catch(reject);
  });
process.on('message', (message) => {
  if (message.type === 'reply') {
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback?.reject(new Error(message.error));
    else callback?.resolve(message.value);
  } else if (message.type === 'cancel') {
    abort.abort(new Error('用户停止了分析'));
    for (const callback of pending.values())
      callback.reject(abort.signal.reason);
    pending.clear();
  } else if (message.type === 'start') void execute(message);
});
process.on('disconnect', () => process.exit(0));
async function execute({ sourcePath, question, resume, scratch }) {
  const ava = new AVA({
    telemetry: true,
    llm: {
      model: process.env.OPENAI_MODEL,
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      maxRetries: 1,
      onQueryUsage: (usage) => {
        void send({ type: 'usage', usage }).catch(() => {});
      },
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
    await ava.schema();
    await ava.profile({ metrics: ['row_count', 'null_count'] });
    const result = await ava.analyze(question, {
      maxRows: 200,
      maxResultBytes: 1024 * 1024,
      strategy: {
        type: 'loop',
        maxSteps: 12,
        control: {
          resumeFrom: resume,
          signal: abort.signal,
          onCheckpoint: (state) => request('checkpoint', state),
          beforeStep: (state) => request('ready', state),
        },
      },
    });
    await send({ type: 'done', result });
  } catch (error) {
    failed = true;
    await send({
      type: 'failed',
      error: error.message,
      cancelled: abort.signal.aborted,
    }).catch(() => {});
  } finally {
    await ava.dispose().catch(() => {});
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
    process.exit(failed ? 1 : 0);
  }
}
