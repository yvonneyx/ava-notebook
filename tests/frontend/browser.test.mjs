import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { createServer } from 'vite';

let server, readCSV, chartDocument;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  ({ readCSV } = await server.ssrLoadModule('/src/runtime/csv.ts'));
  ({ chartDocument } = await server.ssrLoadModule('/src/ui/chart-document.ts'));
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
    new File(
      [
        Array.from({ length: 201 }, (_, i) => `c${i}`).join(',') +
          '\n' +
          Array(201).fill('1').join(','),
      ],
      'wide.csv',
    ),
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

test('chart JSON stays inert and reports initialization even when offscreen painting is suspended', () => {
  const config = JSON.parse(
    '{"type":"table","data":[{"__proto__":{"value":1},"note":"</script><img src=x onerror=alert(1)>"}]}',
  );
  const html = chartDocument(
    config,
    'https://notebook.test/gpt-vis.js',
    'test-nonce',
  );
  assert.ok(!html.includes('</script><img'));
  assert.match(html, /default-src 'none'/);
  let rendered;
  const messages = [];
  const frames = [];
  const context = createContext({
    GPTVis: {
      GPTVis: class {
        render(value) {
          rendered = value;
        }
        destroy() {}
      },
    },
    parent: { postMessage: (message) => messages.push(message) },
    addEventListener() {},
    requestAnimationFrame(callback) { frames.push(callback); },
  });
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))
    if (script.trim()) runInContext(script, context);
  assert.equal(JSON.stringify(rendered), JSON.stringify(config));
  assert.ok(Object.hasOwn(rendered.data[0], '__proto__'));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chart, 'test-nonce');
  assert.equal(messages[0].error, undefined);
  frames.shift()();
  frames.shift()();
  assert.equal(messages[1].ready, true);
  assert.equal(messages[1].chart, 'test-nonce');
});
