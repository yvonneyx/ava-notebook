import type { Source } from '../../shared/contracts';

export async function readCSV(file: File): Promise<Source> {
  if (!/\.csv$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error('请上传 1 字节至 10 MB 的 CSV 文件');
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('CSV 必须是 UTF-8 文本');
  const { parse } = await import('csv-parse/browser/esm/sync');
  let count = 0;
  const records = parse(text, {
    bom: true,
    skip_empty_lines: true,
    max_record_size: 1024 * 1024,
    on_record(record: string[]) {
      if (!count && record.length > 200)
        throw new Error('CSV 最多支持 200 个字段，请精简列后重试');
      if (++count > 100001) throw new Error('一期最多支持 100,000 行数据');
      return count <= 6 ? record : null;
    },
  }) as string[][];
  const headers = records[0];
  if (
    count < 2 ||
    !headers?.length ||
    headers.some((name) => !name.trim()) ||
    new Set(headers).size !== headers.length
  )
    throw new Error('CSV 需包含唯一非空表头和至少一行数据');
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const source: Source = {
    id: crypto.randomUUID(),
    name: file.name,
    bytes: file.size,
    hash,
    headers,
    rows: count - 1,
    preview: records
      .slice(1)
      .map((row) =>
        Object.fromEntries(headers.map((name, i) => [name, row[i]])),
      ),
  };
  return source;
}
