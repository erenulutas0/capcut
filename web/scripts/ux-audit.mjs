/**
 * First-time-user walk through the kesit editor (ADR-026) for the UX audit
 * (docs/ux/2026-09-30-kesit-flow-audit.md). Real screenshots of the running
 * app at four sizes, one per step, plus two measurements per step:
 *   - controls smaller than 44 × 44 CSS px (doc 06 policy) and 24 × 24
 *     (WCAG 2.2 AA 2.5.8, before its spacing exception);
 *   - technical words visible on the page (GiB, fps, codec, OPFS …).
 * Nothing leaves the machine: local test media, the save dialog replaced by a
 * file in the page's own storage (OPFS), as in the e2e tests.
 *
 * Usage: npm run build && npx next start -p 3207   (in another shell)
 *        node scripts/ux-audit.mjs --out=../docs/ux/2026-09-30 --prefix=before
 *        SHOT_URL=http://127.0.0.1:3207 by default.
 *
 * Works on builds before and after ADR-030 (where "Bitişi işaretle" adds the
 * kesit): "Kesit ekle" is pressed only when marking the end added nothing.
 * The report counts the mouse presses of the three core tasks (a press on
 * the page, plus one for "Kaydet" in the operating system's save dialog,
 * which the stand-in dialog here does not need).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { installSavePicker, removeSavePicker } from './lib/kesit-flow.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);
const outDir = resolve(root, args.out ?? '../docs/ux/2026-09-30');
const prefix = args.prefix ?? 'before';
const only = args.only ? new Set(args.only.split(',')) : null;
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3207';
const sample = join(root, 'tests', 'media', 'sample-24s.mp4');
const notVideo = join(root, 'tests', 'media', 'tone-30s.m4a');

mkdirSync(outDir, { recursive: true });

const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true, mobile: true },
];

const TECH_WORDS = /(GiB|MiB|KiB|\bfps\b|SSIM|OPFS|[Cc]odec|µs|H\.264|\bAAC\b|\bSDR\b|\bHDR\b|bitrate|[Ee]ncode|[Ee]xport|[Kk]odla\S*|Space|Ctrl\S*)/g;

const report = { prefix, baseURL, sizes: {} };

async function measure(page) {
  return page.evaluate((techSource) => {
    const tech = new RegExp(techSource, 'g');
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, summary, [role=button], [tabindex="0"]')) {
      if (!visible(el) || el.closest('.visually-hidden')) continue;
      if (el instanceof HTMLInputElement && el.classList.contains('visually-hidden')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) {
        const name =
          el.getAttribute('aria-label') ||
          el.getAttribute('data-testid') ||
          (el.textContent || '').trim().slice(0, 30) ||
          el.tagName.toLowerCase();
        small.push({ name, w: Math.round(rect.width), h: Math.round(rect.height), under24: rect.width < 24 || rect.height < 24 });
      }
    }
    const text = document.body.innerText;
    const words = [...new Set(text.match(tech) ?? [])];
    return { small, words };
  }, TECH_WORDS.source);
}

async function walk(browser, size) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    hasTouch: Boolean(size.touch),
    isMobile: Boolean(size.mobile),
  });
  const page = await context.newPage();
  await installSavePicker(page, { plainNames: true });
  const steps = [];
  /** Presses on the page, per core task (ADR-026 counting: every press). */
  let presses = 0;
  const press = async (locator) => {
    presses += 1;
    return size.touch ? locator.tap() : locator.click();
  };
  const kesitCount = async () => Number(((await page.getByTestId('moment-count').textContent()) ?? '(0)').replace(/\D/g, ''));
  /** Bitişi işaretle; then "Kesit ekle" only on a build where the end did not add the kesit. */
  const markEndAndAdd = async () => {
    const before = await kesitCount();
    await press(page.getByTestId('mark-end'));
    await page.waitForTimeout(150);
    if ((await kesitCount()) === before) await press(page.getByTestId('add-moment'));
  };
  const clicks = {};
  const shot = async (step, { full = size.name === 'phone' } = {}) => {
    await page.waitForTimeout(250);
    const file = `${prefix}-${size.name}-${step}.png`;
    await page.screenshot({ path: join(outDir, file), fullPage: full });
    steps.push({ step, file, ...(await measure(page)) });
  };
  /** Clicks the strip at a fraction of its width, like a user would. */
  const stripAt = async (fraction) => {
    const content = page.getByTestId('strip-content');
    const box = await content.boundingBox();
    if (!box) throw new Error('strip not visible');
    const at = { x: box.x + box.width * fraction, y: box.y + box.height * 0.7 };
    presses += 1;
    if (size.touch) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);
  };

  // 1. The first thing a visitor sees: the site's front page, then the editor.
  await page.goto(`${baseURL}/`);
  await shot('00-landing', { full: true });
  await page.goto(`${baseURL}/editor`);
  await page.getByTestId('download-all').waitFor();
  await shot('01-editor-empty');

  // 2. Open a video.
  await page.getByTestId('video-input').setInputFiles(sample);
  await page.getByTestId('preview-video').waitFor();
  await page.waitForTimeout(800);
  await shot('02-video-open');
  // A first-run hint, where the build has one: read, then "Anladım".
  const dismiss = page.getByTestId('first-run-dismiss');
  if (await dismiss.isVisible().catch(() => false)) await press(dismiss);

  // 3. Mark: move on the strip, press Başlangıç (I), move, press Bitiş (O).
  presses = 0;
  await stripAt(0.1);
  await press(page.getByTestId('mark-start'));
  await shot('03-start-marked');
  await stripAt(0.3);
  const beforeEnd = await kesitCount();
  await press(page.getByTestId('mark-end'));
  await page.waitForTimeout(150);
  await shot('04-end-marked');

  // 4. Kesit ekle (before ADR-030; since then the end added it).
  if ((await kesitCount()) === beforeEnd) await press(page.getByTestId('add-moment'));
  await shot('05-kesit-added');
  if (size.name === 'phone') {
    // What the screen shows right after adding (the phone bar, ADR-030).
    await page.waitForTimeout(250);
    const file = `${prefix}-${size.name}-05b-kesit-added-viewport.png`;
    await page.screenshot({ path: join(outDir, file) });
    steps.push({ step: '05b-kesit-added-viewport', file, ...(await measure(page)) });
  }

  // 5. Download that one kesit from its card; progress, then the result.
  await press(page.getByTestId('kesit-download').first());
  await page.getByTestId('download-running').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await shot('06-downloading');
  await page.getByTestId('download-saved').waitFor({ timeout: 120_000 });
  await shot('07-saved');
  clicks.oneRange = presses + 1;

  // 6. Two more kesitler: the top button becomes "Hepsini birleştirip indir".
  // Counted as the second core task: three ranges (the first one above) and
  // the joined download at step 10.
  presses = clicks.oneRange - 2; // the first range's marking presses, without its card download and dialog
  for (const [a, b] of [
    [0.4, 0.55],
    [0.7, 0.85],
  ]) {
    await stripAt(a);
    await press(page.getByTestId('mark-start'));
    await stripAt(b);
    await markEndAndAdd();
  }
  const threeMarked = presses;
  await shot('08-three-kesits');
  if (size.name === 'phone') {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    const file = `${prefix}-${size.name}-08b-three-kesits-viewport.png`;
    await page.screenshot({ path: join(outDir, file) });
    steps.push({ step: '08b-three-kesits-viewport', file, ...(await measure(page)) });
  }

  // 7. Select a kesit (fine-tune mode).
  await press(page.getByTestId('kesit-select').nth(1));
  await shot('09-kesit-selected');
  await press(page.getByTestId('kesit-done'));

  // 8. Ayarlar and Diğer.
  await press(page.getByTestId('open-settings'));
  await page.getByRole('dialog').waitFor();
  await shot('10-settings', { full: false });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await press(page.getByTestId('open-more'));
  await page.getByRole('dialog').waitFor();
  await shot('11-more', { full: false });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });

  // 9a. "Kesit ekle" with nothing marked (ADR-030: no whole-video kesit).
  const beforeEmptyAdd = await kesitCount();
  await press(page.getByTestId('add-moment'));
  await shot('12a-add-nothing-marked');
  if ((await kesitCount()) !== beforeEmptyAdd) {
    // A build before ADR-030 added the whole video: take it back.
    await page.getByTestId('undo').click();
  }

  // 9. A refusal: a typed range that ends before it starts.
  await page.getByTestId('range-start').fill('00:10');
  await page.getByTestId('range-end').fill('00:05');
  await page.getByTestId('range-end').press('Enter');
  await press(page.getByTestId('add-moment'));
  await shot('12-refusal-reversed');

  // 10. The joined download.
  presses = threeMarked;
  await press(page.getByTestId('download-all'));
  clicks.threeJoined = presses + 1;
  // The joined download's status sits under the list heading, not on a card.
  await page.locator('.kesits > [data-testid="export-succeeded"]').waitFor({ timeout: 120_000 });
  await shot('13-joined-saved');

  // 11. A file that is not a video.
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.getByTestId('video-input').setInputFiles(notVideo);
  await page.getByTestId('media-error').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await shot('14-not-a-video');
  await context.close();

  // 12. A browser without the save dialog (Firefox, Safari): the fallback route.
  if (size.name === 'desktop' || size.name === 'phone') {
    const fallback = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      hasTouch: Boolean(size.touch),
      isMobile: Boolean(size.mobile),
    });
    const other = await fallback.newPage();
    await removeSavePicker(other);
    await other.goto(`${baseURL}/editor`);
    await other.getByTestId('video-input').setInputFiles(sample);
    await other.getByTestId('preview-video').waitFor();
    await other.getByTestId('download-all').click();
    // The whole video: this press, and "Bilgisayara kaydet" (the save dialog's
    // "Kaydet" on the route with a dialog).
    clicks.wholeVideo = 2;
    await other.getByTestId('export-download').waitFor({ timeout: 120_000 });
    await other.waitForTimeout(250);
    const file = `${prefix}-${size.name}-15-no-save-dialog.png`;
    await other.screenshot({ path: join(outDir, file), fullPage: size.name === 'phone' });
    steps.push({ step: '15-no-save-dialog', file, ...(await measure(other)) });
    await fallback.close();
  }
  steps.push({ step: 'clicks', ...clicks });
  return steps;
}

const browser = await chromium.launch();
for (const size of SIZES) {
  if (only && !only.has(size.name)) continue;
  report.sizes[size.name] = await walk(browser, size);
  console.log(`${size.name}: ${report.sizes[size.name].length} steps`);
}
await browser.close();
writeFileSync(join(outDir, `${prefix}-measurements.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(`written to ${outDir}`);
