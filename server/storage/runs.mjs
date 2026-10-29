import { mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { root, validId } from './files.mjs';

let database;
function openDatabase() {
  return (database ??= (async () => {
    await mkdir(root, { recursive: true });
    const path = join(root, 'notebook.sqlite');
    const db = new DatabaseSync(path);
    try {
      await chmod(path, 0o600);
      db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS direct_runs (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
      `);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  })().catch((error) => {
    database = undefined;
    throw error;
  }));
}

export async function initializeStore() {
  await openDatabase();
}

export async function closeStore() {
  if (!database) return;
  (await database).close();
  database = undefined;
}
export async function saveRun(run) {
  if (!validId(run.id)) throw new Error('Invalid task id');
  const db = await openDatabase();
  db.prepare(
    `INSERT INTO direct_runs (id, created_at, body) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, body = excluded.body`,
  ).run(run.id, run.createdAt, JSON.stringify(run));
}
export async function readRun(id) {
  if (!validId(id)) throw new Error('Invalid task id');
  const db = await openDatabase();
  const row = db.prepare('SELECT body FROM direct_runs WHERE id = ?').get(id);
  if (!row)
    throw Object.assign(new Error('未找到分析记录'), { code: 'ENOENT' });
  return JSON.parse(row.body);
}
export async function listRuns() {
  const db = await openDatabase();
  return db
    .prepare('SELECT body FROM direct_runs ORDER BY created_at DESC')
    .all()
    .map((row) => JSON.parse(row.body));
}
export async function deleteRun(id) {
  if (!validId(id)) throw new Error('Invalid task id');
  const db = await openDatabase();
  db.prepare('DELETE FROM direct_runs WHERE id = ?').run(id);
}
