import type { Source } from '../../shared/contracts';

export const MAX_SEMANTIC_BYTES = 64 * 1024;
export type SemanticFormat = 'text' | 'structured';
const fields = new Set([
  'description',
  'properties',
  'models',
  'relationships',
  'views',
  'cubes',
]);

export async function createSemantic(
  name: string,
  value: unknown,
): Promise<NonNullable<Source['semantic']>> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('AVA 语义定义必须是一个对象');
  const definition = value as Record<string, unknown>;
  if (
    !Object.keys(definition).length ||
    Object.keys(definition).some((key) => !fields.has(key))
  )
    throw new Error(
      '语义定义需使用 description、properties、models 等 AVA 字段；普通说明请选择文字说明',
    );
  if (
    definition.description !== undefined &&
    typeof definition.description !== 'string'
  )
    throw new Error('description 必须是文字说明');
  if (
    definition.properties !== undefined &&
    (!definition.properties ||
      typeof definition.properties !== 'object' ||
      Array.isArray(definition.properties))
  )
    throw new Error('properties 必须是一个对象');
  for (const key of ['models', 'relationships', 'views', 'cubes'])
    if (definition[key] !== undefined && !Array.isArray(definition[key]))
      throw new Error(`${key} 必须是一个数组`);
  let serialized: string;
  try {
    serialized = JSON.stringify(definition);
  } catch {
    throw new Error('语义定义必须能转换为 JSON，请检查循环引用');
  }
  const bytes = new TextEncoder().encode(serialized);
  if (bytes.byteLength > MAX_SEMANTIC_BYTES)
    throw new Error('语义口径不能超过 64 KB');
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  return {
    name:
      typeof name === 'string'
        ? name.trim().slice(0, 200) || '业务口径'
        : '业务口径',
    hash,
    definition: JSON.parse(serialized),
  };
}

export async function parseSemantic(
  text: string,
  format: SemanticFormat,
  name = '业务口径',
) {
  if (!text.trim()) throw new Error('请填写业务口径，或移除已有口径');
  if (new TextEncoder().encode(text).byteLength > MAX_SEMANTIC_BYTES)
    throw new Error('语义口径不能超过 64 KB');
  if (format === 'text')
    return createSemantic(name, { description: text.trim() });
  const { parse } = await import('yaml');
  return createSemantic(
    name,
    parse(text, { maxAliasCount: 50, uniqueKeys: true }),
  );
}
