import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

let server, readCSV;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  ({ readCSV } = await server.ssrLoadModule('/src/browser-api.ts'));
});
after(async () => {
  await server?.close();
});

test('browser CSV reader preserves quoted cells and enforces import boundaries', async () => {
  const text = '\uFEFFregion,sales\n"East, Coast",12.5\n"North\nWest",8\n';
  const source = await readCSV(new File([text], 'sales.csv'));
  assert.equal(source.rows, 2);
  assert.deepEqual(source.preview, [
    { region: 'East, Coast', sales: '12.5' },
    { region: 'North\nWest', sales: '8' },
  ]);
  assert.equal(source.hash, createHash('sha256').update(text).digest('hex'));
  for (const invalid of [
    new File(['a,b\n'], 'empty.csv'),
    new File(['a,a\n1,2'], 'duplicate.csv'),
    new File(['a, \n1,2'], 'blank-header.csv'),
    new File(['a,b\n1,2,3'], 'uneven.csv'),
    new File(['a,b\n1,\0'], 'null.csv'),
    new File([new Uint8Array([0xff, 0xfe])], 'encoding.csv'),
    new File(['a\n1'], 'wrong.txt'),
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.csv'),
    new File(['a\n' + '1\n'.repeat(100001)], 'rows.csv'),
  ])
    await assert.rejects(() => readCSV(invalid));
});

test('published cases use repository examples and retain a complete evidence graph', async () => {
  const text = await readFile(
    new URL('../src/data/cases.json', import.meta.url),
    'utf8',
  );
  const cases = JSON.parse(text);
  assert.equal(cases.length, 2);
  assert.doesNotMatch(
    text,
    /\/Users\/|\/home\/|"(?:apiKey|api_key|prompt|modelSignature|events)"/,
  );
  for (const run of cases) {
    const csvPath =
      run.source.name === 'sales.csv'
        ? '../public/sales.csv'
        : '../sales-case.csv';
    const bytes = await readFile(new URL(csvPath, import.meta.url));
    assert.equal(
      run.source.hash,
      createHash('sha256').update(bytes).digest('hex'),
    );
    assert.equal(run.status, 'completed');
    const ids = new Set(run.nodes.map((node) => node.id));
    assert.equal(ids.size, run.nodes.length);
    assert.ok(ids.has('conclusion'));
    for (const node of run.nodes) {
      for (const parent of node.parents)
        assert.ok(ids.has(parent), `${node.id} → ${parent}`);
      if (node.kind === 'query') assert.ok(node.payload.sql);
      if (node.kind === 'result') assert.ok(Array.isArray(node.payload.data));
    }
  }
});
