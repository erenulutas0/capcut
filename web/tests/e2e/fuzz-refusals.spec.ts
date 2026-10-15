import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

import { addKesit, openEditor } from './kesitFlow';

/**
 * The fuzz run's findings, kept fixed (docs/quality/2026-10-15-fuzz.md).
 *
 * 1. An MP4 whose timing table claims billions of frames (`stts-bozuk.mp4`,
 *    27 KB: one second of test pattern, its `stts` overwritten with seeded
 *    bytes — the corpus's own mutation) froze the tab on every card and in
 *    the editor: the index was read frame by frame on the main thread. It is
 *    now refused at once, as a damaged file, and the page stays responsive.
 * 2. A refused file is told what it really is. Before, an empty file, a
 *    picture, a sound, an AVI and random bytes all heard "the file may be
 *    damaged or this browser does not play this format".
 *
 * Fixtures: tests/media/fuzz/ (under 200 KB each, made with ffmpeg; see the
 * report) and bytes made here.
 */

const FUZZ = join(process.cwd(), 'tests', 'media', 'fuzz');
const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');
/** A 1 × 1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function noise(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

test.use({ storageState: { cookies: [], origins: [] } });

/** The refusal's own sentence (without the dismiss button). */
const refusal = (page: Page) => page.getByTestId('media-error').locator('span').first();

/** The page still answers: its main thread is not stuck. */
async function answers(page: Page): Promise<boolean> {
  return Promise.race([page.evaluate(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))]);
}

test('a damaged index is refused at once, and the tab stays alive (editor and two cards)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const file = join(FUZZ, 'stts-bozuk.mp4');
  const text = '“stts-bozuk.mp4” açılamadı: bu dosya bozuk görünüyor; bu haliyle açılamaz. Dosyayı yeniden indir ya da yeniden kopyala; olmazsa başka bir dosya seç.';

  await openEditor(page);
  const started = Date.now();
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(refusal(page)).toHaveText(text, { timeout: 15_000 });
  expect(Date.now() - started).toBeLessThan(15_000);
  expect(await answers(page)).toBe(true);
  await expect(page.getByTestId('preview-video')).toHaveCount(0);

  for (const task of ['sustur', 'kes']) {
    await page.goto(`/yap/${task}/`);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
    await page.getByTestId('video-input').setInputFiles(file);
    await expect(refusal(page), task).toHaveText(text, { timeout: 15_000 });
    expect(await answers(page), task).toBe(true);
    await expect(page.getByTestId('wizard'), task).toHaveAttribute('data-step', 'pick');
  }
  expect(errors).toEqual([]);
});

test('a refused file is told what it really is, with a way on', async ({ page }) => {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/yap/sustur/');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');

  const cases: { file: Parameters<Page['setInputFiles']>[0]; text: string }[] = [
    {
      file: { name: 'bos.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(0) },
      text: '“bos.mp4” açılamadı: bu dosya boş; içinde hiçbir şey yok. İnerken ya da kopyalanırken bir sorun olmuş olabilir. Dosyayı yeniden indir ya da yeniden kopyala; ya da başka bir dosya seç.',
    },
    {
      file: join(FUZZ, 'kucuk.avi'),
      text: '“kucuk.avi” açılamadı: bu dosya türünü (AVI) açamıyoruz. MP4 ya da MOV türünde bir video seç; telefonla çekilen videolar genelde böyledir.',
    },
    {
      // One frame (1/30 s): "Dikey yap" ended in "Bu tarayıcıda çıktı alınamıyor. İndirilecek kesit yok."
      file: join(FUZZ, 'tek-kare.mp4'),
      text: '“tek-kare.mp4” açılamadı: bu video çok kısa: 0,1 saniyeden kısa bir videodan kesit yapılamaz. Daha uzun bir video seç.',
    },
    {
      // The index was to come at the end; the copy stopped at 55 %.
      file: join(FUZZ, 'dizinsiz-yarim.mp4'),
      text: '“dizinsiz-yarim.mp4” açılamadı: bu video yarım kalmış görünüyor: dosyanın sonu eksik, bu haliyle açılamaz. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.',
    },
    {
      file: { name: 'resim.mp4', mimeType: 'video/mp4', buffer: PNG },
      text: '“resim.mp4” açılamadı: bu bir resim, video değil. Bir video dosyası seç.',
    },
    {
      file: { name: 'sadece-ses.mp4', mimeType: 'video/mp4', buffer: readFileSync(MUSIC) },
      text: '“sadece-ses.mp4” açılamadı: bu dosyada görüntü yok, yalnızca ses var. Görüntüsü olan bir video seç.',
    },
    {
      file: { name: 'rastgele.mp4', mimeType: 'video/mp4', buffer: noise(300_000, 7) },
      text: '“rastgele.mp4” açılamadı: bu dosya bir video gibi görünmüyor; bozuk ya da başka türde bir dosya olabilir. Başka bir video seç.',
    },
  ];
  for (const { file, text } of cases) {
    await page.getByTestId('video-input').setInputFiles(file);
    await expect(refusal(page)).toHaveText(text, { timeout: 30_000 });
    // Never the old guess: nothing about the browser, nothing about a "preview".
    await expect(refusal(page)).not.toContainText(/tarayıcı|önizleme/);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
    await page.getByTestId('media-error-dismiss').click();
  }
  expect(errors).toEqual([]);
  // The empty file is no longer handed to the player (it logged "ERR_REQUEST_RANGE_NOT_SATISFIABLE").
  expect(consoleErrors.filter((line) => /RANGE_NOT_SATISFIABLE/.test(line))).toEqual([]);
});

test('a download with nothing to work on does not blame the browser', async ({ page }) => {
  // A saved recipe whose video is no longer open (after a reload): "source_missing". The same title is used
  // for "no_clips", where the one-frame video ended before it was refused at the pick.
  await openEditor(page);
  await page.getByTestId('video-input').setInputFiles(join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'));
  await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
  await addKesit(page, '00:00.000', '00:04.000');
  await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('moment-count')).toHaveText('(1)', { timeout: 20_000 });
  await page.getByTestId('kesit-download').click();
  const blocked = page.getByTestId('export-blocked');
  await expect(blocked).toContainText('Bu indirme yapılamıyor.');
  await expect(blocked).not.toContainText('Bu tarayıcıda');
  // Still a place to report it.
  await expect(page.getByTestId('export-report')).toBeVisible();
});
