import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const root = resolve(process.env.NOTEBOOK_DATA_DIR || '.ava-notebook');
export const validId = (id) =>
  typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id);
export const digest = (data) => createHash('sha256').update(data).digest('hex');
export async function atomicJSON(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}
