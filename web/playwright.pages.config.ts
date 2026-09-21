import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test of the GitHub Pages build (static export under /capcut). Run
 * after `STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/capcut npm run build`:
 *
 *   npx playwright test -c playwright.pages.config.ts
 *
 * It exists because a sub-path breaks things only in production (worker
 * scripts, fonts, plain links), which the root-path e2e suite cannot see.
 */
const port = process.env.PAGES_PORT ?? '3104';

export default defineConfig({
  testDir: './tests/pages',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}/capcut/`,
    trace: 'off',
    acceptDownloads: true,
  },
  projects: [{ name: 'pages', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `node scripts/serve-static.mjs --dir=out --base=/capcut --port=${port}`,
    url: `http://127.0.0.1:${port}/capcut/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
