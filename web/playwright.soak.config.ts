import { defineConfig, devices } from '@playwright/test';

/**
 * A soak, not a test suite: the burn-in download after a transcript, over and
 * over, to look for a failure that does not happen every time (11 Oct 2026:
 * once on a real machine, gone on the next press). It is not part of CI and
 * proves nothing by passing — it only catches what it catches, and writes
 * down what the failure said (`ExportFailureDetail`).
 *
 * Needs the cloud build (see playwright.cloud.config.ts) and talks only to
 * the local fake of the proxy (127.0.0.1). Environment:
 *
 *   SOAK_CHANNEL     '' (Playwright's Chromium, software codecs) | chrome | msedge (the installed browser: hardware codecs)
 *   SOAK_ITERATIONS  how many fresh pages, one after the other (default 20)
 *   SOAK_PARALLEL    pages running the whole flow at the same time, per iteration (default 1)
 *   SOAK_ROUTE       cloud (default) | device (the on-device stand-in writes the transcript)
 *   SOAK_PLAY        1: the wizard's preview plays while the download runs
 *   SOAK_LOAD        N: N busy threads of this machine's CPU for the length of the run
 *   SOAK_HIDE        1: another tab is brought to the front right after the press (works in a visible window: SOAK_HEADED=1)
 *   SOAK_IDLE        N: the finished transcript is left on screen N seconds before the press
 *   SOAK_FILE        long (4 min 13 s 720p, default) | film (4 min 13 s, 1080p, 23,976 fps, 44,1 kHz, index at the end) | short (24 s)
 *   SOAK_GPU_CRASH   N: gpu-loss.spec.ts — the browser's graphics process is crashed N seconds into the download
 *   SOAK_HEADED      1: a visible window (the installed browsers use their graphics card either way)
 *
 *   PowerShell:  $env:SOAK_CHANNEL='chrome'; npx playwright test -c playwright.soak.config.ts burnin-soak
 */
const port = process.env.E2E_PORT ?? '3100';
const channel = process.env.SOAK_CHANNEL || undefined;

export default defineConfig({
  testDir: './tests/soak',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    locale: 'tr-TR',
    headless: process.env.SOAK_HEADED !== '1',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    {
      name: channel ?? 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
