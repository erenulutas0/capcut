import { defineConfig, devices } from '@playwright/test';

/**
 * The fuzz run (docs/quality/README.md, "Dosya fuzz koşusu"): every file of
 * the generated corpus (scripts/fuzz/make-corpus.mjs) on every task card and
 * in the editor, driven to the download, each cell written down and judged
 * (tests/fuzz/fuzz.spec.ts). Not in CI, not part of `npm run quality`.
 *
 * The runner (scripts/fuzz/run-fuzz.mjs) builds, starts the server on its own
 * port and passes it here; nothing is started from this file.
 */
const port = process.env.FUZZ_PORT ?? '3194';

export default defineConfig({
  testDir: './tests/fuzz',
  outputDir: './test-results/fuzz',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['./tests/e2e/recoveryReporter.ts']],
  timeout: 600_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    // No wait of a cell may last for ever: a control that never comes is a result, not a hang.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    acceptDownloads: true,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    // Local synthetic media only; nothing leaves the machine.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
