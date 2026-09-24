/**
 * Captures real application screenshots of the kesit editor (ADR-026) at
 * 1440 px and 390 px. These are screenshots of the running app, not mockups.
 * New file names (`kesit-list-*.png`), so the older screenshots in
 * web/screenshots/ are never overwritten.
 *
 * Usage: npx next build && npx next start -p 3100   (in another shell)
 *        node scripts/screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { addKesit, closeSheet, installSavePicker, openSettings } from './lib/kesit-flow.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'screenshots');
const sample = join(root, 'tests', 'media', 'sample-24s.mp4');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

mkdirSync(outDir, { recursive: true });

async function seek(page, seconds) {
  await page.evaluate((at) => {
    const video = document.querySelector('[data-testid="preview-video"]');
    if (video) video.currentTime = at;
  }, seconds);
  await page.waitForTimeout(300);
}

/** Video open, three kesitler, the first one saved; the playhead in kesit 2. */
async function prepare(page) {
  await installSavePicker(page);
  await page.goto(`${baseURL}/editor`);
  await page.getByTestId('video-input').setInputFiles(sample);
  await page.getByTestId('preview-video').waitFor();
  await page.getByTestId('project-title').first().fill('Tatil').catch(() => undefined);
  for (const [start, end] of [
    ['00:01.000', '00:05.000'],
    ['00:09.000', '00:14.500'],
    ['00:18.000', '00:21.000'],
  ]) {
    await addKesit(page, start, end);
  }
  await page.getByTestId('kesit-download').first().click();
  await page.getByTestId('download-saved').waitFor({ timeout: 120_000 });
  // A range being marked: I at 15.5 s, O at 17 s.
  await seek(page, 15.5);
  await page.getByTestId('mark-start').click();
  await seek(page, 17);
  await page.getByTestId('mark-end').click();
  await seek(page, 11);
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch();

for (const size of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await prepare(page);
  await page.screenshot({ path: join(outDir, `kesit-list-${size.name}.png`), fullPage: size.name === 'phone' });

  await page.getByTestId('kesit-select').nth(1).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `kesit-list-selected-${size.name}.png`), fullPage: size.name === 'phone' });
  await page.getByTestId('kesit-done').click();

  await openSettings(page, 'frame');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `kesit-list-settings-${size.name}.png`) });
  await closeSheet(page);

  if (size.name === 'desktop') {
    await page.getByTestId('strip-zoom-in').click();
    await page.getByTestId('strip-zoom-in').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, 'kesit-list-zoomed-desktop.png') });
  }
  await context.close();
}

await browser.close();
console.log(`screenshots written to ${outDir}`);
