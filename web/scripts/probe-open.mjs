/**
 * Opens one local file in the editor and prints what the editor says: the
 * timeline summary when it opened, the refusal message when it did not.
 * Used for the byte-limit evidence in ADR-021 (a >4 GiB file against the
 * 2 GiB policy) and ADR-025 (files just under and just over 4 GiB against the
 * 4 GiB policy). Nothing is uploaded; the file stays on this machine.
 *
 *   node scripts/probe-open.mjs --file=tests/media/long/big-60min-1080p-4gib.mp4 [--browser=chrome]
 */
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const fileArg = arg('file', '');
const file = isAbsolute(fileArg) ? fileArg : join(root, fileArg);
const channel = arg('browser', '');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3111';

const browser = await chromium.launch(channel ? { channel } : {});
const page = await browser.newPage();
await page.goto(`${baseURL}/editor`);
await page.getByTestId('open-export').waitFor();
const started = Date.now();
await page.getByTestId('video-input').setInputFiles(file);
const outcome = await Promise.race([
  page.getByTestId('media-error').waitFor({ timeout: 60_000 }).then(() => 'error'),
  page.getByTestId('strip-clip').first().waitFor({ timeout: 60_000 }).then(() => 'opened'),
]);
const text =
  outcome === 'error'
    ? await page.getByTestId('media-error').textContent()
    : await page.getByTestId('output-summary').textContent();
console.log(JSON.stringify({ browser: browser.version(), outcome, ms: Date.now() - started, text: text?.trim() }));
await browser.close();
