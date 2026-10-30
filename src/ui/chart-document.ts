export function chartDocument(
  config: unknown,
  scriptURL: string,
  nonce: string,
) {
  const json = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;font-family:system-ui,sans-serif}#chart{width:100%;height:350px}body{overflow:auto}</style>
</head><body><div id="chart"></div>
<script nonce="${nonce}">
const report = (error) => parent.postMessage({chart: '${nonce}', error: error ? '图表渲染失败，请切换到 Data 查看结果' : undefined}, '*');
addEventListener('error', () => report(true));
addEventListener('unhandledrejection', () => report(true));
</script>
<script nonce="${nonce}" src="${scriptURL}"></script>
<script nonce="${nonce}">
try {
  const chart = new GPTVis.GPTVis({container: '#chart', height: 350});
  chart.render(JSON.parse(${JSON.stringify(json)}));
  // Offscreen iframes may not paint before the load timeout.
  report();
  requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({chart: '${nonce}', ready: true}, '*')));
  addEventListener('pagehide', () => chart.destroy());
} catch { report(true); }
</script></body></html>`;
}
