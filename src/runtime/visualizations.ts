import { AVA } from '@antv/ava/browser';
import type { LLMConfig } from '@antv/ava/browser';
import type { Visualization } from '../../shared/contracts';

export function createVisualizationQueue(
  llm: LLMConfig,
  question: string,
  update: (nodeId: string, visualization: Visualization) => void,
  timeoutMs = 60000,
) {
  const safe = (value: unknown) => {
    const message = String(value ?? '');
    return (
      llm.apiKey ? message.split(llm.apiKey).join('[redacted]') : message
    ).slice(0, 3000);
  };
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
  function add(nodeId: string, rows: Record<string, unknown>[], sql: string) {
    update(nodeId, { status: 'pending' });
    charts.push(
      new Promise<void>((resolve) => {
        waiting.push(async () => {
          const visualizer = new AVA({ llm: { ...llm, maxRetries: 1 } });
          let timer: ReturnType<typeof setTimeout> | undefined;
          let visualization: Visualization;
          try {
            const result = await Promise.race([
              visualizer.visualize({
                query: `请为以下查询结果生成合适的可视化。\n问题：${question}\nSQL：${sql}`,
                data: rows,
              }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('图表生成超时')),
                  timeoutMs,
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
          update(nodeId, visualization);
          resolve();
        });
        pump();
      }),
    );
  }
  return {
    add,
    finish: async () => {
      await Promise.all(charts);
    },
  };
}
