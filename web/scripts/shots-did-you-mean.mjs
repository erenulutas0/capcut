/**
 * Before / after pictures of the search results for docs/ux/2026-10-11-did-you-mean
 * (ADR-034, "Güncelleme — 11 Ekim 2026").
 *
 *   node scripts/shots-did-you-mean.mjs <before|after> [baseUrl]
 *
 * Needs a server showing the app (default http://127.0.0.1:3197). "before" was
 * taken with src/domain/taskSearch.ts and the home screen of commit dd0301b.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const [label = 'after', baseUrl = 'http://127.0.0.1:3197'] = process.argv.slice(2);
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'ux', '2026-10-11-did-you-mean');
mkdirSync(outDir, { recursive: true });

/** What is typed → the file name. The first is answered directly in both; the others are the change. */
const PHRASES = [
  ['dikey yap', 'emin'],
  ['sesi kes', 'iki-secenek'],
  ['bugün hava çok güzel', 'tek-secenek'],
  ['videoyu instagramda paylaş', 'liste-disi'],
];
const VIEWS = [
  ['masaustu', { width: 1440, height: 900 }, false],
  ['telefon', { width: 390, height: 844 }, true],
];

const browser = await chromium.launch();
for (const [view, viewport, touch] of VIEWS) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, locale: 'tr-TR' });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  // The development server's own badge is not part of the app.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  for (const [phrase, name] of PHRASES) {
    await page.getByTestId('finder-input').fill(phrase);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `${label === 'before' ? 'once' : 'sonra'}-${view}-${name}.png`) });
  }
  await context.close();
}
await browser.close();
console.log(`shots: ${outDir}`);
