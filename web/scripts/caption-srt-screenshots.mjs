/**
 * Real screenshots of SRT import (ADR-016): the import dialog for a Turkish
 * Windows-1254 file, and the Altyazı tab with the imported source-anchored
 * track and its usage badges. Desktop 1440x900 and phone 390x844.
 *
 * Usage: npx next build && npx next start -p 3100   (in another shell)
 *        node scripts/caption-srt-screenshots.mjs    (SHOT_URL to override)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { emptyTimeline } from './lib/range-flow.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'screenshots');
const sample = join(root, 'tests', 'media', 'sample-24s.mp4');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

mkdirSync(outDir, { recursive: true });

const CP1254 = { Ç: 0xc7, ç: 0xe7, Ğ: 0xd0, ğ: 0xf0, İ: 0xdd, ı: 0xfd, Ö: 0xd6, ö: 0xf6, Ş: 0xde, ş: 0xfe, Ü: 0xdc, ü: 0xfc };
const CRLF = '\r\n';
const lines = [
  ['00:00:01,000', '00:00:03,000', 'Günaydın İstanbul, ışıklar yanıyor'],
  ['00:00:09,000', '00:00:13,000', 'Şimdi köprüye doğru yürüyoruz'],
  ['00:00:13,000', '00:00:16,000', 'Rüzgâr çok güçlü'],
  ['00:00:17,000', '00:00:19,000', 'Bu bölüm kullanılmadı'],
];
const srt = lines
  .map(([start, end, text], index) => `${index + 1}${CRLF}${start} --> ${end}${CRLF}${text}${CRLF}`)
  .join(CRLF);
const buffer = Buffer.from(Array.from(srt).map((char) => CP1254[char] ?? char.charCodeAt(0)));
const file = { name: 'istanbul-turu.srt', mimeType: 'application/x-subrip', buffer };

/** Moments in reverse source order, so the lines visibly follow the picture. */
async function prepare(page) {
  await page.goto(`${baseURL}/editor`);
  await page.getByTestId('video-input').setInputFiles(sample);
  await page.getByTestId('preview-video').waitFor();
  await emptyTimeline(page);
  for (const [start, end] of [
    ['00:08.000', '00:14.000'],
    ['00:00.000', '00:04.000'],
  ]) {
    await page.getByTestId('range-start').fill(start);
    await page.getByTestId('range-end').fill(end);
    await page.getByTestId('add-moment').click();
  }
}

async function importAsSource(page) {
  const dialog = page.getByRole('dialog', { name: 'Altyazı dosyasını içe aktar' });
  await dialog.getByTestId('caption-import-choice-source').check();
  await dialog.getByTestId('caption-import-confirm').click();
  await dialog.waitFor({ state: 'detached' });
}

const browser = await chromium.launch();

{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await prepare(page);
  await page.getByTestId('inspector-tab-captions').click();
  await page.getByTestId('caption-file-input').setInputFiles(file);
  await page.getByTestId('caption-import-dialog').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(outDir, 'captions-srt-import-desktop-1440x900.png') });

  await importAsSource(page);
  await page.getByRole('tab', { name: 'Sonuç', exact: true }).click();
  await page.getByLabel('Zamanda gezin').fill('2000');
  await page.getByTestId('caption-overlay').and(page.locator('[data-cue-id="q_002"]')).waitFor();
  // Start the panel at line 3 so the partial and unused badges are in view.
  await page.evaluate(() => {
    const scroller = document.querySelector('.panel-right .panel-scroll');
    const line = document.querySelectorAll('[data-testid="cue-item"]')[2];
    if (scroller && line) scroller.scrollTop = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'captions-srt-source-desktop-1440x900.png') });
  await context.close();
}

{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await prepare(page);
  await page.getByTestId('tab-captions').click();
  const sheet = page.getByRole('dialog', { name: 'Altyazı' });
  await sheet.getByTestId('caption-file-input').setInputFiles(file);
  await page.getByTestId('caption-import-dialog').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(outDir, 'captions-srt-import-phone-390x844.png') });

  await importAsSource(page);
  await page.evaluate(() => {
    const body = document.querySelector('.sheet-body');
    const first = document.querySelectorAll('.sheet-body [data-testid="cue-item"]')[2];
    if (body && first) body.scrollTop = first.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'captions-srt-source-phone-390x844.png') });
  await context.close();
}

await browser.close();
console.log(`caption SRT screenshots written to ${outDir}`);
