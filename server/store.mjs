import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  chmod,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';

export const root = resolve(process.env.NOTEBOOK_DATA_DIR || '.ava-notebook');
export const validId = (id) =>
  typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id);
export const digest = (data) => createHash('sha256').update(data).digest('hex');
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
        CREATE TABLE IF NOT EXISTS runs (
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
  const db = await openDatabase();
  const dir = join(root, 'runs');
  await mkdir(dir, { recursive: true });
  const legacy = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validId(entry.name)) continue;
    if (db.prepare('SELECT 1 FROM runs WHERE id = ?').get(entry.name)) continue;
    try {
      const run = JSON.parse(
        await readFile(join(dir, entry.name, 'run.json'), 'utf8'),
      );
      if (run.id !== entry.name) throw new Error('分析记录 ID 与目录不一致');
      legacy.push(run);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  // Keep the old JSON files as backups; never overwrite newer database records.
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO runs (id, created_at, body) VALUES (?, ?, ?)',
    );
    for (const run of legacy)
      insert.run(run.id, run.createdAt, JSON.stringify(run));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function closeStore() {
  if (!database) return;
  (await database).close();
  database = undefined;
}
export async function atomicJSON(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}
export const runDir = (id) => {
  if (!validId(id)) throw new Error('Invalid task id');
  return join(root, 'runs', id);
};
export async function saveRun(run) {
  if (!validId(run.id)) throw new Error('Invalid task id');
  const db = await openDatabase();
  db.prepare(
    `INSERT INTO runs (id, created_at, body) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, body = excluded.body`,
  ).run(run.id, run.createdAt, JSON.stringify(run));
}
export async function readRun(id) {
  if (!validId(id)) throw new Error('Invalid task id');
  const db = await openDatabase();
  const row = db.prepare('SELECT body FROM runs WHERE id = ?').get(id);
  if (!row)
    throw Object.assign(new Error('未找到分析记录'), { code: 'ENOENT' });
  return JSON.parse(row.body);
}
export async function listRuns() {
  const db = await openDatabase();
  return db
    .prepare('SELECT body FROM runs ORDER BY created_at DESC')
    .all()
    .map((row) => JSON.parse(row.body));
}
export async function saveCheckpoint(run, key, checkpoint) {
  if (!validId(key)) throw new Error('Invalid checkpoint id');
  await atomicJSON(
    join(runDir(run.id), 'checkpoints', `${key}.json`),
    checkpoint,
  );
}
export async function readCheckpoint(run, key) {
  if (!validId(key)) throw new Error('Invalid checkpoint id');
  try {
    return JSON.parse(
      await readFile(
        join(runDir(run.id), 'checkpoints', `${key}.json`),
        'utf8',
      ),
    );
  } catch (error) {
    if (error.code === 'ENOENT' && run.parentId)
      return readCheckpoint(await readRun(run.parentId), key);
    throw error;
  }
}
export function inspectCSV(bytes, name) {
  if (!/\.csv$/i.test(name)) throw new Error('一期仅支持 .csv 文件');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new Error('CSV 文件需在 1 字节至 10 MB 之间');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('CSV 必须是 UTF-8 文本');
  let count = 0;
  const records = parse(text, {
    bom: true,
    skip_empty_lines: true,
    max_record_size: 1024 * 1024,
    on_record(record) {
      count++;
      if (count > 100001) throw new Error('一期最多支持 100,000 行数据');
      return count <= 6 ? record : null;
    },
  });
  const headers = records[0];
  if (!headers?.length || count < 2)
    throw new Error('CSV 需要一行表头和至少一行数据');
  if (
    headers.some((v) => !v.trim()) ||
    new Set(headers).size !== headers.length
  )
    throw new Error('CSV 表头不能为空或重复');
  return {
    headers,
    rows: count - 1,
    preview: records
      .slice(1)
      .map((row) =>
        Object.fromEntries(headers.map((name, i) => [name, row[i]])),
      ),
  };
}
export async function createSource(bytes, name, semantic) {
  const info = inspectCSV(bytes, name);
  const source = {
    id: randomUUID(),
    name,
    bytes: bytes.length,
    hash: digest(bytes),
    ...(semantic
      ? {
          semantic: {
            ...semantic,
            hash: digest(JSON.stringify(semantic.definition)),
          },
        }
      : {}),
    ...info,
  };
  const dir = join(root, 'sources', source.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'data.csv'), bytes, { mode: 0o600 });
  await atomicJSON(join(dir, 'source.json'), source);
  return source;
}
export async function readSource(id) {
  if (!validId(id)) throw new Error('Invalid source id');
  const dir = join(root, 'sources', id);
  const source = JSON.parse(await readFile(join(dir, 'source.json'), 'utf8'));
  if (digest(await readFile(join(dir, 'data.csv'))) !== source.hash)
    throw new Error('数据快照已变化，请重新导入');
  if (
    source.semantic &&
    digest(JSON.stringify(source.semantic.definition)) !== source.semantic.hash
  )
    throw new Error('语义快照已变化，请重新导入');
  return { source, path: join(dir, 'data.csv') };
}
