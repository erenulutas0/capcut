import { defineConfig, devices } from '@playwright/test';

/**
 * The Pages smoke test against the PUBLISHED site (no local server, no build):
 *
 *   npx playwright test -c playwright.live.config.ts
 *
 * It answers "is what users get right now working?". Everything still happens
 * in the browser: the test videos are opened on the device, nothing is sent
 * anywhere. The one test that reads the local `out/` folder is skipped here
 * (`--grep-invert` in the npm script is not needed: it checks files on disk,
 * which say nothing about the published site).
 */
const baseURL = process.env.LIVE_URL ?? 'https://erenulutas0.github.io/capcut/';

// The smoke test counts requests to any other origin as leaving the site.
process.env.PAGES_SITE_ORIGIN = new URL(baseURL).origin;

export default defineConfig({
  testDir: './tests/pages',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  grepInvert: /compiled files only/,
  use: {
    baseURL,
    trace: 'off',
    acceptDownloads: true,
  },
  projects: [{ name: 'live', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
