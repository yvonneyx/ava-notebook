import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { directRun } from '../fixtures/direct-events.mjs';

test('SQLite retains new event-derived evidence across restarts without importing old JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ava-store-test-'));
  process.env.NOTEBOOK_DATA_DIR = dir;
  const store = await import('../../server/storage/index.mjs');
  try {
    await store.atomicJSON(join(dir, 'runs', 'legacy', 'run.json'), {
      id: 'legacy',
      nodes: [],
    });
    const old = new DatabaseSync(join(dir, 'notebook.sqlite'));
    old.exec(
      "CREATE TABLE runs (id TEXT PRIMARY KEY, body TEXT); INSERT INTO runs VALUES ('old', '{}')",
    );
    old.close();
    await store.initializeStore();
    assert.deepEqual(await store.listRuns(), []);
    const run = {
      ...directRun(),
      id: 'new-direct',
      createdAt: '2026-10-29T00:00:00Z',
      revision: 1,
      events: [],
    };
    await store.saveRun(run);
    await store.closeStore();
    await store.initializeStore();
    assert.equal(
      (await readFile(join(dir, 'notebook.sqlite'))).subarray(0, 15).toString(),
      'SQLite format 3',
    );
    assert.deepEqual(await store.readRun(run.id), run);
    run.revision++;
    await store.saveRun(run);
    assert.deepEqual(await store.listRuns(), [run]);
    await assert.rejects(store.readRun('missing'), { code: 'ENOENT' });
    await assert.rejects(store.readRun('../escape'), /Invalid task id/);
    await store.saveRun({ ...run, id: 'keep-direct' });
    await assert.rejects(store.deleteRun('../escape'), /Invalid task id/);
    await store.deleteRun(run.id);
    await store.closeStore();
    await store.initializeStore();
    await assert.rejects(store.readRun(run.id), { code: 'ENOENT' });
    assert.deepEqual((await store.listRuns()).map((item) => item.id), ['keep-direct']);
  } finally {
    await store.closeStore();
    await rm(dir, { recursive: true, force: true });
  }
});
