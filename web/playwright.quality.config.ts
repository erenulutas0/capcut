import { defineConfig, devices } from '@playwright/test';

/**
 * The quality measurement layer (docs/quality/README.md): `npm run quality`.
 *
 * These are measurements, not pass/fail tests: every spec under
 * tests/quality writes what it measured into `.scratch/quality/results/`
 * and the runner (scripts/quality/run.mjs) judges the numbers against
 * scripts/quality/budgets.json and writes the report. A spec fails only when
 * the measurement itself could not be taken.
 *
 * The runner starts the server (the static export, or the test-hooks build
 * for the one section that needs the stand-in recogniser) on its own port
 * and passes it here; nothing is started from this file.
 */
const port = process.env.QUALITY_PORT ?? '3195';

export default defineConfig({
  testDir: './tests/quality',
  outputDir: './test-results/quality',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 600_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    // No step of a measurement may wait for ever: a control that never comes is a result, not a hang.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    acceptDownloads: true,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    // Local synthetic media only; nothing leaves the machine.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
