import { AVA } from '@antv/ava/duckdb-wasm';
import { bundles } from './duckdb-bundles';
import type { Visualization } from '../../shared/contracts';

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
  // Chart calls use their own AVA instance and never enter the analysis event stream.
  const waiting: Array<() => Promise<void>> = [];
  const charts: Promise<void>[] = [];
  let generating = 0;
  function pump() {
    while (generating < 2 && waiting.length) {
      generating++;
      void waiting.shift()!().finally(() => {
        generating--;
        pump();
      });
    }
  }
  function visualize(
    nodeId: string,
    rows: Record<string, unknown>[],
    sql: string,
  ) {
    self.postMessage({
      type: 'visualization',
      nodeId,
      visualization: { status: 'pending' },
    });
    charts.push(
      new Promise<void>((resolve) => {
        waiting.push(async () => {
          const visualizer = new AVA({ llm: { ...data.llm, maxRetries: 1 } });
          let timer: ReturnType<typeof setTimeout> | undefined;
          let visualization: Visualization;
          try {
            const result = await Promise.race([
              visualizer.visualize({
                query: `请为以下查询结果生成合适的可视化。\n问题：${data.question}\nSQL：${sql}`,
                data: rows,
              }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('图表生成超时')),
                  60000,
                );
              }),
            ]);
            if (
              result &&
              new TextEncoder().encode(JSON.stringify(result.config)).length >
                1024 * 1024
            )
              throw new Error('图表配置超过 1 MiB，请精简分析结果后重试');
            visualization = result
              ? {
                  status: 'ready',
                  chartType: result.chartType,
                  config: result.config,
                }
              : { status: 'empty' };
          } catch (error: any) {
            visualization = { status: 'failed', error: safe(error.message) };
          } finally {
            clearTimeout(timer);
            await visualizer.dispose().catch(() => {});
          }
          self.postMessage({ type: 'visualization', nodeId, visualization });
          resolve();
        });
        pump();
      }),
    );
  }
  const queries = new Map<string, string>();
  ava.on('*', (event: any) => {
    // Model errors can include request credentials or raw provider responses.
    if (event.data?.error)
      event.data.error = {
        name: event.data.error.name,
        message: safe(event.data.error.message),
      };
    self.postMessage({ type: 'event', event });
    const pair = event.context?.eventId?.replace(/:(start|end)$/, '');
    if (event.type === 'querystart') queries.set(pair, event.data.dsl);
    if (
      event.type === 'queryend' &&
      !event.data?.error &&
      event.data?.data?.length
    )
      visualize(
        event.context.eventId,
        event.data.data,
        queries.get(pair) || '',
      );
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
    await Promise.all(charts);
    self.postMessage({ type: 'finished' });
    self.close();
  }
};
