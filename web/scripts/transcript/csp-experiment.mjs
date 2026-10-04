/**
 * Is `'wasm-unsafe-eval'` really needed (ADR-036, security doc)?
 *
 * The speech model's WebAssembly is compiled inside the transcript WORKER. A
 * worker started from a URL takes its policy from its own response headers,
 * not from the page's <meta>; a static host sends none. So the page's policy
 * may not reach that compile at all. This script answers with a measurement
 * instead of an argument: it serves the wizard page with the keyword taken
 * OUT of the policy (rewriting the HTML on the way to the browser) and runs
 * a real transcription, per browser; then again with the shipped policy.
 *
 *   node scripts/transcript/csp-experiment.mjs --base=http://127.0.0.1:3321 [--browsers=chromium,firefox,chrome,msedge]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, firefox } from '@playwright/test';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const base = arg('base', 'http://127.0.0.1:3321').replace(/\/+$/, '');
const browsers = arg('browsers', 'chromium,firefox').split(',');
const clip = join(webDir, 'tests', 'media', 'transcript', 'en-01.mp4');

async function run(name, withKeyword) {
  const engine = name === 'firefox' ? firefox : chromium;
  const browser = await engine.launch(name === 'chrome' || name === 'msedge' ? { channel: name } : {});
  const context = await browser.newContext();
  const page = await context.newPage();
  const violations = [];
  await page.addInitScript(() => {
    window.__clipTranscriptRuns = [];
    document.addEventListener('securitypolicyviolation', (event) => console.error(`[csp] ${event.effectiveDirective} ${event.blockedURI}`));
  });
  const watch = (source) => source.on('console', (message) => {
    if (/\[csp\]|Content Security Policy|Content-Security-Policy/i.test(message.text())) violations.push(message.text().slice(0, 200));
  });
  watch(page);
  page.on('worker', watch);
  let policy = null;
  await page.route('**/yap/yazi**', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    let html = await response.text();
    if (!withKeyword) html = html.replace(" 'wasm-unsafe-eval'", '');
    policy = /script-src ([^;]*)/.exec(html)?.[1]?.replace(/'sha256-[^']+'/g, "'sha256-…'") ?? null;
    await route.fulfill({ response, body: html });
  });
  const result = { browser: name, version: browser.version(), withKeyword, scriptSrc: null, outcome: null, text: null, violations };
  try {
    await page.goto(`${base}/yap/yazi/`, { waitUntil: 'load' });
    result.scriptSrc = policy;
    await page.setInputFiles('[data-testid="video-input"]', clip);
    await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"]', { timeout: 120_000 });
    if (await page.locator('[data-testid="model-download"]').count()) {
      await page.locator('[data-testid="model-download"]').click();
      await page.waitForSelector('[data-testid="transcribe-start"]', { timeout: 600_000 });
    }
    await page.locator('[data-testid="transcribe-start"]').click();
    await page.waitForFunction(
      () => window.__clipTranscriptRuns.length > 0 || document.querySelector('[data-testid="transcribe-failed"]') !== null,
      null,
      { timeout: 600_000 },
    );
    if (await page.locator('[data-testid="transcribe-failed"]').count()) {
      result.outcome = `failed: ${await page.locator('[data-testid="transcribe-failed"]').getAttribute('data-reason')}`;
    } else {
      result.outcome = 'transcribed';
      await page.waitForSelector('[data-testid="transcript-panel"]', { timeout: 30_000 });
      result.text = await page.evaluate(() => Array.from(document.querySelectorAll('.transcript-text')).map((el) => el.textContent).join(' '));
    }
  } catch (error) {
    result.outcome = `error: ${`${error?.message ?? error}`.slice(0, 200)}`;
  }
  await browser.close();
  return result;
}

for (const name of browsers) {
  for (const withKeyword of [false, true]) {
    console.log(JSON.stringify(await run(name, withKeyword)));
  }
}
