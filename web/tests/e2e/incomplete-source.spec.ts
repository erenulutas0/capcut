import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

import { installSavePicker, opfsFiles, pickerCalls } from './kesitFlow';
import { halfDownloaded } from './wizard-media';

/**
 * ADR-040: a video that is not all there — a download or a copy that stopped
 * half way. Its index (at the start of the file) still lists the full 24
 * seconds, so the browser opens it and shows "24,0 sn"; the bytes of the
 * second half are simply missing.
 *
 * One behaviour everywhere: the file is refused when it is picked, in plain
 * words that say what is wrong with the FILE and what to do about it. No
 * wizard and no editor download may save a file whose end is missing or
 * silent and call it "Kaydedildi", and nobody in Chrome is told to try Chrome.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');
const TASKS = ['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'sustur', 'cevir', 'iyilestir'] as const;

const REFUSAL =
  /^“yarim-inmis\.mp4” açılamadı: bu video yarım kalmış görünüyor: 24,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk \d{1,2},\d sn var\. İnerken ya da kopyalanırken yarıda kesilmiş olabilir\. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene\.$/;

async function savedFiles(page: Page): Promise<string[]> {
  return Object.keys(await opfsFiles(page)).filter((name) => name.startsWith('saved-'));
}

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page }) => {
  await installSavePicker(page);
});

test('every wizard refuses half a video when it is picked: what is wrong, what to do, nothing about the browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const half = halfDownloaded(SAMPLE, 'sample-24s', 0.55);
  for (const task of TASKS) {
    await page.goto(`/yap/${task}`);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
    await page.getByTestId('video-input').setInputFiles(half);
    const notice = page.getByTestId('media-error');
    await expect(notice, task).toBeVisible({ timeout: 30_000 });
    await expect(notice.locator('span').first(), task).toHaveText(REFUSAL);
    await expect(notice, task).not.toContainText(/tarayıcı|Chrome|Edge/i);
    // Still on the first step: nothing opened, nothing to download, the picker can be used again.
    await expect(page.getByTestId('wizard'), task).toHaveAttribute('data-step', 'pick');
    await expect(page.getByTestId('pick-video'), task).toBeEnabled();
    await expect(page.getByTestId('wizard-download'), task).toHaveCount(0);
  }
  expect(await pickerCalls(page)).toEqual([]);
  expect(await savedFiles(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('how far the file goes is said, and it grows with the bytes that arrived', async ({ page }) => {
  const readable: number[] = [];
  for (const share of [0.3, 0.55, 0.9]) {
    await page.goto('/yap/dikey');
    await page.getByTestId('video-input').setInputFiles(halfDownloaded(SAMPLE, 'sample-24s', share));
    const text = (await page.getByTestId('media-error').locator('span').first().textContent({ timeout: 30_000 })) ?? '';
    const found = /yalnızca ilk (\d{1,2}),(\d) sn var/.exec(text);
    expect(found, text).not.toBeNull();
    readable.push(Number(`${found?.[1]}.${found?.[2]}`));
  }
  expect(readable[0]).toBeGreaterThan(1);
  expect(readable[0]).toBeLessThan(readable[1] ?? 0);
  expect(readable[1]).toBeLessThan(readable[2] ?? 0);
  expect(readable[2]).toBeLessThan(23);
});

test('the editor refuses it the same way, and an open video stays open', async ({ page }) => {
  await page.goto('/editor');
  await page.getByTestId('video-input').setInputFiles(halfDownloaded(SAMPLE, 'sample-24s', 0.55));
  await expect(page.getByTestId('media-error').locator('span').first()).toHaveText(REFUSAL, { timeout: 30_000 });
  await expect(page.getByTestId('preview-video')).toHaveCount(0);

  // With a whole video open first, the refusal says that it is still there.
  await page.getByTestId('media-error-dismiss').click();
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('video-input').setInputFiles(halfDownloaded(SAMPLE, 'sample-24s', 0.55));
  await expect(page.getByTestId('media-error')).toContainText('Açık olan videon değişmedi.', { timeout: 30_000 });
  await expect(page.getByTestId('source-meta')).toContainText('sample-24s.mp4');
});

test('half a music file is refused in “Müzik ekle”; the video stays', async ({ page }) => {
  await page.goto('/yap/muzik');
  await page.getByTestId('video-input').setInputFiles(SAMPLE);
  await expect(page.getByTestId('muzik-pick')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('audio-input').setInputFiles(halfDownloaded(MUSIC, 'tone-30s', 0.5));
  await expect(page.getByTestId('media-error').locator('span').first()).toHaveText(
    /^“yarim-inmis\.m4a” açılamadı: bu müzik dosyası yarım kalmış görünüyor: 30,0 sn uzunluğunda olması gerekirken dosyada yalnızca ilk \d{1,2},\d sn var\. Dosyayı yeniden indir ya da yeniden kopyala, sonra tekrar dene\.$/,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('muzik-picked')).toHaveCount(0);
  await expect(page.getByTestId('wizard-video-name')).toHaveText('sample-24s.mp4');
});

test('a whole file with its index first is not mistaken for half a one', async ({ page }) => {
  await page.goto('/yap/ses');
  await page.getByTestId('video-input').setInputFiles(halfDownloaded(SAMPLE, 'sample-24s', 1));
  await expect(page.getByTestId('ses-info')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('media-error')).toHaveCount(0);
  await expect(page.getByTestId('wizard-video-length')).toHaveText('24,0 sn');
});

/**
 * The export's own refusal. The page's check is switched off with the test
 * hook (`__clipSkipImportIntegrity`), so the half file opens as it did before
 * 10 Oct 2026 — showing "24,0 sn" — and "İndir" is pressed. Before: "Sesini
 * al" saved 24 s whose end was silence, "Boşlukları at" saved 12.5 s, the
 * others blamed the browser. Now every road ends in the same honest failure
 * and nothing is saved.
 */
test.describe('if half a video ever reaches “İndir”, the export refuses it and saves nothing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __clipSkipImportIntegrity: boolean }).__clipSkipImportIntegrity = true;
    });
  });

  for (const task of ['ses', 'sustur', 'dikey', 'cevir'] as const) {
    test(`${task}: “Bu sefer olmadı”, the file is named as the problem, no “Kaydedildi”, no file`, async ({ page }) => {
      await page.goto(`/yap/${task}`);
      await page.getByTestId('video-input').setInputFiles(halfDownloaded(SAMPLE, 'sample-24s', 0.55));
      await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
      await expect(page.getByTestId('wizard-video-length')).toHaveText('24,0 sn');
      await expect(page.getByTestId('wizard-download')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('wizard-download').click();
      await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('wizard-title')).toHaveText('Bu sefer olmadı');
      await expect(page.getByTestId('export-failed-reason')).toHaveText(
        'Bu video yarım kalmış görünüyor: sonu dosyada yok. İnerken ya da kopyalanırken yarıda kesilmiş olabilir. Videoyu yeniden indir ya da yeniden kopyala, sonra tekrar dene.',
      );
      await expect(page.getByTestId('export-failed')).not.toContainText(/tarayıcı|Chrome|Edge/i);
      await expect(page.getByTestId('download-saved')).toHaveCount(0);
      // The save dialog made the file; the failed export took it back.
      expect(await savedFiles(page)).toEqual([]);
    });
  }

  test('bosluk: the search runs on what is there, but “İndir” saves nothing shorter than it says', async ({ page }) => {
    await page.goto('/yap/bosluk');
    await page.getByTestId('video-input').setInputFiles(halfDownloaded(SAMPLE, 'sample-24s', 0.55));
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
    // Whatever the search made of half a sound track: a download is either not offered, or refused.
    const download = page.getByTestId('wizard-download');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="bosluk-summary"], [data-testid="bosluk-problem"], [data-testid="bosluk-unclear"]') !== null,
      undefined,
      { timeout: 120_000 },
    );
    if ((await download.count()) > 0 && (await download.isEnabled())) {
      await download.click();
      await expect(page.getByTestId('export-failed-reason')).toContainText('Bu video yarım kalmış görünüyor', { timeout: 120_000 });
    }
    await expect(page.getByTestId('download-saved')).toHaveCount(0);
    expect(await savedFiles(page)).toEqual([]);
  });
});

test('“Chrome ya da Edge ile dene” is advice for another browser: it is not in the failure a Chromium user reads', async ({ page }) => {
  // The words exist (for Firefox and Safari) but are never part of the sentence itself.
  await page.goto('/yap/dikey');
  const sentence = await page.evaluate(() => navigator.userAgent);
  expect(sentence).toMatch(/Chrome\//);
  await page.addInitScript(() => {
    (window as unknown as { __clipSkipImportIntegrity: boolean }).__clipSkipImportIntegrity = true;
  });
  await page.reload();
  await page.getByTestId('video-input').setInputFiles(halfDownloaded(SAMPLE, 'sample-24s', 0.55));
  await expect(page.getByTestId('wizard-download')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('export-failed')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('export-failed-browser')).toHaveCount(0);
});
