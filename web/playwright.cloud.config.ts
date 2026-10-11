import { defineConfig, devices } from '@playwright/test';

/**
 * The cloud transcript route (ADR-039) against a LOCAL FAKE of our proxy
 * Worker (cloud/fake-worker/server.mjs, started by the tests themselves on
 * 127.0.0.1). No external service is contacted; the fake hears nothing and
 * writes the words the test scripted.
 *
 * The route exists only in a build that names the proxy, so these tests need
 * their own build (the default e2e build proves the opposite: no route):
 *
 *   PowerShell:  $env:CLIP_TEST_HOOKS='1'; $env:NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL='http://127.0.0.1:38197'; npm run build
 *   then:        npx playwright test -c playwright.cloud.config.ts
 *
 * Rebuild without the variable before running the ordinary suite again
 * (`.next` holds one build at a time; both suites say so when they meet the
 * wrong one).
 */
const port = process.env.E2E_PORT ?? '3100';

export default defineConfig({
  testDir: './tests/cloud',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    locale: 'tr-TR',
    // Local synthetic media only; the only other host is the fake on 127.0.0.1.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
