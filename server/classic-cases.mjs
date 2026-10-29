import { readFile } from 'node:fs/promises';
import { createSource, digest, readRun, saveRun } from './store.mjs';

const datasets = {
  'case-regional-sales': '../data/classic-cases/case-regional-sales/data.csv',
  'case-product-profitability': '../data/classic-cases/case-regional-sales/data.csv',
  'case-sales-performance':
    '../data/classic-cases/36053ce8-7ce7-4059-9391-51b3cd1c6376/data.csv',
};

export async function seedClassicCases() {
  const snapshots = JSON.parse(
    await readFile(new URL('../src/data/cases.json', import.meta.url), 'utf8'),
  );
  for (const snapshot of snapshots) {
    if (
      !datasets[snapshot.id] ||
      snapshot.status !== 'completed' ||
      !snapshot.nodes.some((node) => node.kind === 'step')
    )
      throw new Error('经典案例必须使用新版步骤事件');
    try {
      await readRun(snapshot.id);
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const bytes = await readFile(
      new URL(datasets[snapshot.id], import.meta.url),
    );
    if (digest(bytes) !== snapshot.source.hash)
      throw new Error('经典案例数据指纹不匹配');
    const source = await createSource(
      bytes,
      snapshot.source.name,
      snapshot.source.semantic,
    );
    await saveRun({
      ...snapshot,
      source,
      nodes: snapshot.nodes.map((node) =>
        node.kind === 'source' ? { ...node, payload: source } : node,
      ),
    });
  }
}
