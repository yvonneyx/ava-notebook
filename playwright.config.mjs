import { defineConfig } from '@playwright/test';
// Local test servers must bypass any desktop proxy.
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost']
  .filter(Boolean)
  .join(',');
process.env.no_proxy = process.env.NO_PROXY;
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  timeout: 90000,
  workers: 1,
  reporter: 'list',
  use: {
    browserName: process.env.NOTEBOOK_TEST_BROWSER || 'chromium',
    channel:
      !process.env.NOTEBOOK_TEST_BROWSER ||
      process.env.NOTEBOOK_TEST_BROWSER === 'chromium'
        ? 'chrome'
        : undefined,
    launchOptions: {
      ...(process.env.NOTEBOOK_TEST_EXECUTABLE
        ? { executablePath: process.env.NOTEBOOK_TEST_EXECUTABLE }
        : {}),
      ...(process.env.NOTEBOOK_TEST_BROWSER === 'firefox'
        ? { firefoxUserPrefs: { 'network.proxy.type': 0 } }
        : {}),
    },
    headless: true,
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      timeout: 30000,
    },
    {
      command:
        'npm run preview -- --host 127.0.0.1 --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      timeout: 30000,
    },
  ],
});
