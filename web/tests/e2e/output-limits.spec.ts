import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import {
  addKesit,
  closeSheet,
  noSavePicker,
  openEditor,
  openSettings,
  openVideo,
  opfsFiles,
  installSavePicker,
} from './kesitFlow';
import { timelineFixture } from './timeline-media';

/**
 * Policy v3 (doc 15, ADR-020): 60 minutes of output where the file goes to
 * disk, 5 minutes where it has to be held in memory; ADR-023: the space is
 * claimed before encoding; ADR-026: the same for the file picked in the save
 * dialog. Plus the frame chosen from the opened video's orientation.
 */

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');

const exportFiles = async (page: Page) =>
  Object.keys(await opfsFiles(page)).filter((name) => name.startsWith('clip-export-'));

/** Presses the top button and watches until it ends; records whether encoding ever showed progress. */
async function downloadUntilEnd(page: Page) {
  await page.getByTestId('download-all').click();
  let sawEncoding = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      progress: document.querySelector('[data-testid="export-progress"]')?.textContent ?? '',
      succeeded: document.querySelector('[data-testid="export-succeeded"]') !== null,
      failed: document.querySelector('[data-testid="export-failed"]') !== null,
    }));
    // The encoding phase shows a percentage; preparing does not.
    if (/%\d+/.test(state.progress)) sawEncoding = true;
    if (state.succeeded) return { end: 'succeeded' as const, sawEncoding };
    if (state.failed) return { end: 'failed' as const, sawEncoding };
    await page.waitForTimeout(100);
  }
  return { end: 'timeout' as const, sawEncoding };
}

async function quality720(page: Page) {
  await openSettings(page, 'frame');
  await page.getByTestId('export-quality').selectOption('720');
  await closeSheet(page);
}

test.describe('download wording', () => {
  test('the top button says what it downloads: the video, the kesit, or all joined', async ({ page }) => {
    await noSavePicker(page);
    await openEditor(page);
    await expect(page.getByTestId('download-all')).toHaveText('Videoyu indir');
    await expect(page.getByTestId('download-all')).toBeDisabled();
    await openVideo(page, SAMPLE_VIDEO);
    await expect(page.getByTestId('download-all')).toBeEnabled();
    await addKesit(page, '1', '2');
    await expect(page.getByTestId('download-all')).toHaveText('Kesiti indir');
    await addKesit(page, '3', '4');
    await expect(page.getByTestId('download-all')).toHaveText('Hepsini birleştirip indir');
  });
});

test.describe('memory route: at most 5 minutes (doc 15 v3)', () => {
  test.beforeEach(async ({ page }) => {
    await noSavePicker(page);
    // Behave like a browser without OPFS sync access (test hook, see exportClient).
    await page.addInitScript(() => {
      (window as unknown as { __clipForceMemoryRoute: boolean }).__clipForceMemoryRoute = true;
    });
  });

  test('a 5:10 video is refused before any frame is encoded, with the reason', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await openEditor(page);
    await openVideo(page, timelineFixture('long').file);
    await quality720(page);
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('failed');
    expect(run.sawEncoding).toBe(false);
    await expect(page.getByTestId('export-failed')).toContainText(
      'Bu tarayıcı videoyu diske yazamıyor; burada en fazla 5 dakikalık video indirilebilir.',
    );
    // ADR-021: the same sentence as the 60-minute gate, with this route's cap.
    await expect(page.getByTestId('export-failed-over-limit')).toHaveText(
      'Sonuç 5:10. İndirmek için en az 0:10 sil — sınır 5 dakika.',
    );
    expect(await exportFiles(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a short kesit still downloads through memory, and says so', async ({ page }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    await openVideo(page, SAMPLE_VIDEO);
    await addKesit(page, '0', '3');
    await quality720(page);
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('succeeded');
    await expect(page.getByTestId('measured-route')).toHaveText('bellek');
    const save = page.getByTestId('export-download');
    await expect(save).toHaveText(/Bilgisayara kaydet/);
    const download = page.waitForEvent('download');
    await save.click();
    expect((await download).suggestedFilename()).toBe('sample-24s_00-00-00-03.mp4');
  });
});

test.describe('storage estimate: refused up front when the file will not fit', () => {
  test('a long video with too little quota is refused; a short kesit still works', async ({ page }) => {
    test.setTimeout(240_000);
    await noSavePicker(page);
    // 40 MB free, as the worker's storage estimate will report it (test hook).
    await page.addInitScript(() => {
      (window as unknown as { __clipStorageFreeBytes: number }).__clipStorageFreeBytes = 40 * 1024 * 1024;
    });
    await openEditor(page);
    await openVideo(page, timelineFixture('long').file);
    await quality720(page);
    const long = await downloadUntilEnd(page);
    expect(long.end).toBe('failed');
    expect(long.sawEncoding).toBe(false);
    await expect(page.getByTestId('export-failed')).toContainText('Bu uzunlukta bir video için boş disk alanı yetmiyor.');
    // Both numbers, so the user knows how much to free (ADR-023).
    await expect(page.getByTestId('export-failed-storage')).toHaveText(
      /^Bu video için gereken boş alan: \d+ MiB\. Tarayıcının bildirdiği boş alan: 40 MiB\.$/,
    );
    expect(await exportFiles(page)).toEqual([]);

    // The same quota is plenty for a few seconds of video.
    await addKesit(page, '0', '3');
    const short = await downloadUntilEnd(page);
    expect(short.end).toBe('succeeded');
    await expect(page.getByTestId('measured-route')).toHaveText('tarayıcının geçici diski');
  });
});

/**
 * A real, small quota (ADR-023). Chromium's CDP override does not change what
 * `navigator.storage.estimate()` reports, but the browser enforces it on every
 * OPFS write and truncate, exactly like a full disk.
 */
async function limitQuota(page: Page, bytes: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(page.url()).origin, quotaSize: bytes });
  const free = await page.evaluate(async () => {
    const estimate = await navigator.storage.estimate();
    return (estimate.quota ?? 0) - (estimate.usage ?? 0);
  });
  expect(free).toBeGreaterThan(bytes * 10);
}

test.describe('real quota: the space is claimed before encoding (ADR-023)', () => {
  test('a disk without room refuses before the first frame, and says how much is needed', async ({ page }) => {
    test.setTimeout(180_000);
    await noSavePicker(page);
    const errors = await openEditor(page);
    await limitQuota(page, 64 * 1024 * 1024);
    await openVideo(page, timelineFixture('long').file);
    await quality720(page);
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('failed');
    expect(run.sawEncoding).toBe(false);
    await expect(page.getByTestId('export-failed-storage')).toContainText(
      /Bu video için gereken boş alan: \d+ MiB\. Tarayıcı bu kadar yeri diskte ayıramadı/,
    );
    await expect(page.getByTestId('export-download')).toHaveCount(0);
    expect(await exportFiles(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the file picked in the save dialog: no room is refused before encoding, and nothing is left', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // The stand-in dialog hands out a file in OPFS, so the same quota applies.
    await installSavePicker(page);
    const errors = await openEditor(page);
    await limitQuota(page, 64 * 1024 * 1024);
    await openVideo(page, timelineFixture('long').file);
    await quality720(page);
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('failed');
    expect(run.sawEncoding).toBe(false);
    await expect(page.getByTestId('export-failed-storage')).toHaveText(
      /^Seçtiğin yerde bu video için yaklaşık \d+ MiB boş yer gerekiyor; o diskte bu kadar yer yok\./,
    );
    // The empty file the dialog created is removed again.
    await expect.poll(() => opfsFiles(page)).toEqual({});
    expect(errors).toEqual([]);
  });

  test('a disk that fills up mid-file ends in an honest failure; the partial file is deleted', async ({ page }) => {
    test.setTimeout(240_000);
    await noSavePicker(page);
    // Claim only 1 MiB up front (test hook), so the file must grow into a
    // 3 MiB quota and the browser's own write refusal ends the export.
    await page.addInitScript(() => {
      (window as unknown as { __clipStorageReserveBytes: number }).__clipStorageReserveBytes = 1024 * 1024;
    });
    const errors = await openEditor(page);
    await limitQuota(page, 3 * 1024 * 1024);
    await openVideo(page, timelineFixture('long').file);
    await quality720(page);
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('failed');
    expect(run.sawEncoding).toBe(true);
    await expect(page.getByTestId('export-failed')).toContainText(
      'Video yazılırken diskte yer kalmadı. Yarım dosya silindi',
    );
    await expect(page.getByTestId('export-download')).toHaveCount(0);
    expect(await exportFiles(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the picked file fills the disk mid-file: an honest failure, no half file under its name', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await installSavePicker(page);
    await page.addInitScript(() => {
      (window as unknown as { __clipStorageReserveBytes: number }).__clipStorageReserveBytes = 1024 * 1024;
    });
    const errors = await openEditor(page);
    await limitQuota(page, 3 * 1024 * 1024);
    await openVideo(page, timelineFixture('long').file);
    await quality720(page);
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('failed');
    expect(run.sawEncoding).toBe(true);
    await expect(page.getByTestId('export-failed')).toContainText('diskte yer kalmadı');
    await expect(page.getByTestId('download-saved')).toHaveCount(0);
    await expect.poll(() => opfsFiles(page)).toEqual({});
    expect(errors).toEqual([]);
  });
});

test.describe('the frame follows the opened video', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const aspectPressed = async (page: Page, aspect: string) => {
    await openSettings(page, 'frame');
    await expect(page.getByTestId(`aspect-${aspect}`)).toHaveAttribute('aria-pressed', 'true');
    await closeSheet(page);
  };

  test('portrait → 9:16 with a notice; undoing the import restores the old frame', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await aspectPressed(page, '16-9');
    await openVideo(page, timelineFixture('portrait').file);
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-aspect', '9:16');
    await expect(page.getByTestId('timeline-notice')).toContainText('Dikey video: 9:16 çerçeve seçildi');
    await aspectPressed(page, '9-16');
    // One undo: the import itself, frame included.
    await page.getByTestId('undo').click();
    await aspectPressed(page, '16-9');
  });

  test('landscape → 16:9; replacing it with a portrait video switches to 9:16', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await openSettings(page, 'frame');
    await page.getByTestId('aspect-1-1').click();
    await closeSheet(page);
    await openVideo(page, SAMPLE_VIDEO);
    await expect(page.getByTestId('timeline-notice')).toContainText('Yatay video: 16:9 çerçeve seçildi');
    await aspectPressed(page, '16-9');
    await page.getByTestId('video-input').setInputFiles(timelineFixture('portrait').file);
    await expect(page.getByTestId('source-meta')).toContainText('portrait-110s.mp4');
    await aspectPressed(page, '9-16');
  });

  test('restoring a saved project keeps the frame the user chose', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase('clip-editor');
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        }),
    );
    await openEditor(page);
    await openVideo(page, timelineFixture('portrait').file);
    await addKesit(page, '5', '10');
    await openSettings(page, 'frame');
    await page.getByTestId('aspect-1-1').click();
    await closeSheet(page);
    await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await aspectPressed(page, '1-1');
    await page.getByTestId('relink-video-input').setInputFiles(timelineFixture('portrait').file);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await aspectPressed(page, '1-1');
  });
});
