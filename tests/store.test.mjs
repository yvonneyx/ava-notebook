import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('SQLite storage migrates history and installs portable classic cases', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ava-store-test-'));
  process.env.NOTEBOOK_DATA_DIR = dir;
  const store = await import('../server/store.mjs');
  const { seedClassicCases } = await import('../server/classic-cases.mjs');
  const ids = ['36053ce8-7ce7-4059-9391-51b3cd1c6376', 'case-regional-sales'];
  try {
    await t.test(
      'a new installation gets both complete cases without a model',
      async () => {
        await store.initializeStore();
        await seedClassicCases();
        const cases = await store.listRuns();
        assert.deepEqual(cases.map((run) => run.id).sort(), ids);
        assert.equal(
          (await readFile(join(dir, 'notebook.sqlite')))
            .subarray(0, 15)
            .toString(),
          'SQLite format 3',
        );
        for (const run of cases) {
          const raw = await readFile(
            new URL(
              `../data/classic-cases/${run.id}/run.json`,
              import.meta.url,
            ),
            'utf8',
          );
          assert.doesNotMatch(
            raw,
            /\/Users\/|"apiKey"|"api_key"|"authorization"/i,
          );
          const source = await store.readSource(run.source.id);
          const expected = JSON.parse(raw, (_key, value) =>
            typeof value === 'string'
              ? value.replaceAll('@@SOURCE_CSV@@', source.path)
              : value,
          );
          assert.deepEqual(run, expected);
          assert.equal(run.result.completionReason, 'confirmed');
          assert.equal(source.source.rows, run.source.rows);
          for (const node of run.nodes.filter((node) => node.checkpoint)) {
            const checkpoint = await store.readCheckpoint(run, node.checkpoint);
            assert.ok(checkpoint.version);
            assert.doesNotMatch(
              JSON.stringify(checkpoint),
              /@@SOURCE_CSV@@|\/Users\//,
            );
          }
        }
      },
    );

    await t.test(
      'restart keeps edits and does not duplicate or overwrite seeded cases',
      async () => {
        const run = await store.readRun(ids[0]);
        run.revision++;
        run.caseStudy.description = 'A locally updated description';
        await store.saveRun(run);
        await store.closeStore();
        await store.initializeStore();
        await seedClassicCases();
        assert.deepEqual(await store.readRun(run.id), run);
        assert.equal((await store.listRuns()).length, 2);
      },
    );

    await t.test(
      'legacy JSON migrates once and cannot overwrite newer database state',
      async () => {
        const legacy = {
          id: 'legacy-run',
          createdAt: '2020-01-01T00:00:00Z',
          status: 'paused',
          nodes: [],
          revision: 2,
        };
        const path = join(store.runDir(legacy.id), 'run.json');
        await store.atomicJSON(path, legacy);
        await store.initializeStore();
        assert.deepEqual(await store.readRun(legacy.id), legacy);
        const updated = { ...legacy, status: 'completed', revision: 3 };
        await store.saveRun(updated);
        await store.closeStore();
        await store.initializeStore();
        assert.deepEqual(await store.readRun(legacy.id), updated);
        assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), legacy);
        assert.equal((await store.listRuns()).length, 3);
        await assert.rejects(store.readRun('missing'), { code: 'ENOENT' });
        await assert.rejects(store.readRun('../escape'), /Invalid task id/);
      },
    );
  } finally {
    await store.closeStore();
    await rm(dir, { recursive: true, force: true });
  }
});
