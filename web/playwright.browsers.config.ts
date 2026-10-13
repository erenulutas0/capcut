import { defineConfig, devices } from '@playwright/test';

/**
 * The other-engines suite (docs/quality/README.md, "Diğer tarayıcı motorları"):
 * Firefox and WebKit, desktop and phone-sized, against the build people get
 * (`npm run build` + `next start`, no test hooks).
 *
 * NOT part of the default e2e run and not a CI gate: `npm run browsers`.
 *
 * What these builds are — and are not:
 *  - `webkit` is Playwright's WebKit build for this operating system. On
 *    Windows it is NOT Safari: its media stack (codecs, WebCodecs, hardware
 *    encoders) differs from macOS / iOS.
 *  - `firefox` is Playwright's patched desktop Firefox. It is not Firefox for
 *    Android. Firefox has no mobile emulation: "phone" is a 390 × 844 touch
 *    viewport of the desktop engine.
 *  - `chromium-desktop` is the control: the same walk in the engine the rest
 *    of the tests use, so a failure of the suite itself is told apart from a
 *    finding about an engine.
 */
const port = process.env.BROWSERS_PORT ?? '3196';

const phoneViewport = { width: 390, height: 844 };

export default defineConfig({
  testDir: './tests/browsers',
  outputDir: './test-results/browsers',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 420_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    // No step may wait for ever: a control that never comes is a finding, not a hang.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    acceptDownloads: true,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    // Firefox cannot emulate a mobile device (no isMobile): a touch viewport of the desktop engine.
    { name: 'firefox-phone', use: { ...devices['Desktop Firefox'], viewport: phoneViewport, hasTouch: true } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-phone', use: { ...devices['iPhone 14'], viewport: phoneViewport } },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    // Never another checkout's build: the suite starts its own server and stops it.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
