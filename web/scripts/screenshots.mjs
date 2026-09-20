/**
 * Captures real application screenshots at the four review widths, plus a
 * 200% zoom check. These are screenshots of the running app, not mockups.
 *
 * Usage: npx next build && npx next start -p 3100   (in another shell)
 *        node scripts/screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'screenshots');
const sample = join(root, 'tests', 'media', 'sample-24s.mp4');
const music = join(root, 'tests', 'media', 'tone-30s.m4a');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

mkdirSync(outDir, { recursive: true });

const SIZES = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1366x768', width: 1366, height: 768 },
  { name: 'tablet-1024x768', width: 1024, height: 768 },
  { name: 'phone-390x844', width: 390, height: 844 },
];

async function prepare(page) {
  await page.goto(`${baseURL}/editor`);
  await page.getByTestId('video-input').setInputFiles(sample);
  await page.getByTestId('preview-video').waitFor();
  for (const [start, end] of [
    ['00:00.000', '00:04.000'],
    ['00:08.000', '00:14.000'],
    ['00:18.000', '00:22.000'],
  ]) {
    await page.getByTestId('range-start').fill(start);
    await page.getByTestId('range-end').fill(end);
    await page.getByTestId('add-moment').click();
  }
  await page.getByTestId('audio-input').setInputFiles(music);
  await page.getByTestId('music-file-name').waitFor({ state: 'attached' }).catch(() => {});
  await page.waitForTimeout(400);
}

const browser = await chromium.launch();

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await prepare(page);
  await page.screenshot({ path: join(outDir, `editor-${size.name}.png`) });

  if (size.name === 'phone-390x844') {
    await page.getByTestId('tab-frame').click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, 'phone-390x844-frame-sheet.png') });
    await page.keyboard.press('Escape');
  }
  if (size.name === 'desktop-1440x900') {
    await page.getByTestId('open-export').click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, 'export-dialog-1440x900.png') });
    await page.keyboard.press('Escape');

    await page.goto(`${baseURL}/`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(outDir, 'landing-1440x900.png') });
  }
  if (size.name === 'tablet-1024x768') {
    await page.getByTestId('open-inspector-drawer').click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, 'tablet-1024x768-inspector-drawer.png') });
    await page.keyboard.press('Escape');
  }
  await context.close();
}

// 200% browser zoom on a 1440x900 screen behaves like a 720x450 CSS viewport.
const zoomContext = await browser.newContext({
  viewport: { width: 720, height: 450 },
  deviceScaleFactor: 2,
});
const zoomPage = await zoomContext.newPage();
await prepare(zoomPage);
const overflow = await zoomPage.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
await zoomPage.screenshot({ path: join(outDir, 'zoom-200-1440x900.png') });
await zoomContext.close();
await browser.close();

console.log(`screenshots written to ${outDir}`);
console.log(`200% zoom horizontal overflow: ${overflow}px`);
