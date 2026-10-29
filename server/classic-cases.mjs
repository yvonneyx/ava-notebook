import {
  readFile,
  readdir,
  mkdir,
  copyFile,
  constants,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  root,
  validId,
  digest,
  atomicJSON,
  readRun,
  saveRun,
  readSource,
  saveCheckpoint,
} from './store.mjs';

const casesDir = fileURLToPath(
  new URL('../data/classic-cases/', import.meta.url),
);

export async function seedClassicCases() {
  for (const entry of await readdir(casesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validId(entry.name)) continue;
    try {
      await readRun(entry.name);
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const dir = join(casesDir, entry.name);
    const raw = await readFile(join(dir, 'run.json'), 'utf8');
    const snapshot = JSON.parse(raw);
    if (
      snapshot.id !== entry.name ||
      snapshot.status !== 'completed' ||
      !snapshot.caseStudy?.title ||
      !validId(snapshot.source.id)
    )
      throw new Error(`无效的经典案例：${entry.name}`);
    const bytes = await readFile(join(dir, 'data.csv'));
    if (digest(bytes) !== snapshot.source.hash)
      throw new Error(`经典案例数据指纹不匹配：${entry.name}`);
    const sourceDir = join(root, 'sources', snapshot.source.id);
    const sourcePath = join(sourceDir, 'data.csv');
    const revive = (_key, value) =>
      typeof value === 'string'
        ? value.replaceAll('@@SOURCE_CSV@@', sourcePath)
        : value;
    const run = JSON.parse(raw, revive);
    await mkdir(sourceDir, { recursive: true });
    try {
      await copyFile(
        join(dir, 'data.csv'),
        sourcePath,
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    try {
      const source = await readSource(run.source.id);
      if (source.source.hash !== run.source.hash)
        throw new Error(`经典案例与已有数据快照冲突：${entry.name}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomicJSON(join(sourceDir, 'source.json'), run.source);
      await readSource(run.source.id);
    }
    for (const node of run.nodes.filter((node) => node.checkpoint)) {
      if (!validId(node.checkpoint)) throw new Error('无效的案例检查点');
      const checkpoint = JSON.parse(
        await readFile(
          join(dir, 'checkpoints', `${node.checkpoint}.json`),
          'utf8',
        ),
        revive,
      );
      await saveCheckpoint(run, node.checkpoint, checkpoint);
    }
    // Publish the case only after its source and every checkpoint are durable.
    await saveRun(run);
  }
}
