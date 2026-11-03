import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server, parseSemantic, createSemantic, MAX_SEMANTIC_BYTES;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  ({ parseSemantic, createSemantic, MAX_SEMANTIC_BYTES } =
    await server.ssrLoadModule('/src/domain/semantic.ts'));
});
after(async () => {
  await server?.close();
});

test('plain business rules and imported JSON/YAML keep the same AVA definition and fingerprint', async () => {
  const text = await parseSemantic(
    '  净销售额扣除退款。比较各月日均。  ',
    'text',
  );
  assert.deepEqual(text.definition, {
    description: '净销售额扣除退款。比较各月日均。',
  });
  const value = {
    description: '净销售额口径',
    properties: { accounting: 'gross_sales - discount_amount - refund_amount' },
  };
  const json = await parseSemantic(
    JSON.stringify(value),
    'structured',
    'finance.json',
  );
  const yaml = await parseSemantic(
    'description: 净销售额口径\nproperties:\n  accounting: gross_sales - discount_amount - refund_amount\n',
    'structured',
    'finance.yaml',
  );
  assert.deepEqual(json.definition, yaml.definition);
  assert.equal(json.hash, yaml.hash);
  assert.match(json.hash, /^[a-f0-9]{64}$/);
  assert.equal(yaml.name, 'finance.yaml');
  value.properties.accounting = 'changed';
  assert.notEqual(
    json.definition.properties.accounting,
    value.properties.accounting,
  );
});

test('semantic import rejects wrong structures, oversized documents, duplicate keys and cycles', async () => {
  for (const text of [
    '[]',
    'null',
    '{}',
    'description: [invalid]',
    'properties: []',
    'models: wrong',
    'unexpected: ignored',
    'description: a\ndescription: b',
    'properties: &a { cycle: *a }',
  ])
    await assert.rejects(() => parseSemantic(text, 'structured'));
  await assert.rejects(() => parseSemantic(' ', 'text'), /请填写业务口径/);
  await assert.rejects(
    () => parseSemantic('x'.repeat(MAX_SEMANTIC_BYTES + 1), 'text'),
    /64 KB/,
  );
  await assert.rejects(
    () => createSemantic('invalid', { views: 'wrong' }),
    /views/,
  );
});
