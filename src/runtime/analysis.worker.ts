import { AVA } from '@antv/ava/duckdb-wasm';
import { bundles } from './duckdb-bundles';

self.onmessage = async ({ data }) => {
  const ava = new AVA({
    llm: { ...data.llm, maxRetries: 1 },
    engine: {
      type: 'duckdb-wasm',
      bundles,
      queryTimeoutMs: 30000,
      memoryLimit: '512MB',
    },
  });
  const safe = (value: unknown) =>
    String(value ?? '')
      .split(data.llm.apiKey)
      .join('[redacted]')
      .slice(0, 3000);
  ava.on('*', (event: any) => {
    // Model errors can include request credentials or raw provider responses.
    if (event.data?.error)
      event.data.error = {
        name: event.data.error.name,
        message: safe(event.data.error.message),
      };
    self.postMessage({ type: 'event', event });
  });
  try {
    await ava.source({ type: 'csv', options: { csv: await data.file.text() } });
    self.postMessage({ type: 'context', data: { schema: await ava.schema() } });
    self.postMessage({
      type: 'context',
      data: {
        profile: await ava.profile({ metrics: ['row_count', 'null_count'] }),
      },
    });
    const result = await ava.analyze(data.question, {
      strategy: { type: data.strategy },
      maxRows: 200,
      maxResultBytes: 1024 * 1024,
    });
    self.postMessage({ type: 'done', result });
  } catch (error: any) {
    self.postMessage({
      type: 'failed',
      error: {
        name: error.name,
        message: /DuckDB.*(download|worker|initialization)/i.test(error.message)
          ? '浏览器分析引擎加载失败，请刷新页面并检查网络后重试'
          : /Failed to fetch|Load failed|NetworkError when attempting to fetch/i.test(
              error.message,
            )
          ? '无法连接模型，请检查 API 地址、网络和接口的跨域（CORS）配置'
          : safe(error.message),
      },
    });
  } finally {
    await ava.dispose().catch(() => {});
    self.close();
  }
};
