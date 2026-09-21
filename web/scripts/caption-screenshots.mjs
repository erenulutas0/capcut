/**
 * Real screenshots of the caption editor with a caption visible in the result
 * preview: desktop 1440x900 and phone 390x844 (dark theme, the app's only one).
 *
 * Usage: npx next build && npx next start -p 3100   (in another shell)
 *        node scripts/caption-screenshots.mjs        (SHOT_URL to override)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'screenshots');
const sample = join(root, 'tests', 'media', 'sample-24s.mp4');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';

mkdirSync(outDir, { recursive: true });

async function prepare(page) {
  await page.goto(`${baseURL}/editor`);
  await page.getByTestId('video-input').setInputFiles(sample);
  await page.getByTestId('preview-video').waitFor();
  for (const [start, end] of [
    ['00:00.000', '00:04.000'],
    ['00:08.000', '00:14.000'],
  ]) {
    await page.getByTestId('range-start').fill(start);
    await page.getByTestId('range-end').fill(end);
    await page.getByTestId('add-moment').click();
  }
}

async function typeLine(page, scope, text) {
  await scope.getByTestId('captions-add').click();
  const field = scope.getByTestId('cue-draft').getByTestId('cue-text');
  await field.waitFor();
  await page.keyboard.type(text);
  await field.blur();
}

const browser = await chromium.launch();

// Desktop: the Altyazı tab in the inspector, a caption on the result preview.
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await prepare(page);
  await page.getByTestId('inspector-tab-captions').click();
  await page.getByRole('tab', { name: 'Sonuç', exact: true }).click();
  await page.getByLabel('Zamanda gezin').fill('1000');
  await typeLine(page, page, 'Günaydın İstanbul! Bugün ılık ve güneşli.');
  await page.getByLabel('Zamanda gezin').fill('5000');
  await typeLine(page, page, 'Şimdi köprüye doğru yürüyoruz');
  await page.getByTestId('cue-item').first().getByTestId('cue-goto').click();
  await page.getByTestId('caption-overlay').and(page.locator('[data-cue-id="q_001"]')).waitFor();
  // Show the panel from its top: the add button, then the lines.
  await page.evaluate(() => document.querySelector('.panel-right .panel-scroll')?.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'captions-desktop-1440x900.png') });
  await context.close();
}

// Phone: the caption sheet, then the preview with the caption drawn.
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
  await typeLine(page, sheet, 'Telefondan ilk altyazı: çok güzel!');
  await sheet.getByTestId('caption-preset-outline').check();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(outDir, 'captions-phone-390x844-sheet.png') });
  await page.keyboard.press('Escape');
  await page.getByTestId('caption-overlay').and(page.locator('[data-cue-id="q_001"]')).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'captions-phone-390x844.png') });
  await context.close();
}

await browser.close();
console.log(`caption screenshots written to ${outDir}`);
