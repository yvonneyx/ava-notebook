import mvpModule from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehModule from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
export const bundles = {
  mvp: {
    mainModule: new URL(mvpModule, location.href).href,
    mainWorker: new URL(mvpWorker, location.href).href,
  },
  eh: {
    mainModule: new URL(ehModule, location.href).href,
    mainWorker: new URL(ehWorker, location.href).href,
  },
};
