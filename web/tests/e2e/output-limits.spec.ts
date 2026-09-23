import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { timelineFixture } from './timeline-media';

/**
 * Policy v3 (doc 15, ADR-020): 60 minutes of output where the file is
 * streamed to the browser's private disk (OPFS), 5 minutes where it has to be
 * held in memory. Plus the download wording and the frame chosen from the
 * opened video's orientation.
 */

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');

async function openEditor(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('open-export')).toBeVisible();
  return errors;
}

async function openVideo(page: Page, file: string) {
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await expect(page.getByTestId('strip-clip')).toHaveCount(1);
}

function listExportFiles(page: Page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (name.startsWith('clip-export-')) names.push(name);
    }
    return names;
  });
}

async function openExportReady(page: Page) {
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-quality').selectOption('720');
  await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
}

/** Watches the dialog until it ends; records whether encoding ever showed progress. */
async function runUntilEnd(page: Page) {
  await page.getByTestId('export-create').click();
  let sawEncoding = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    // Read the DOM directly: a locator would wait for a missing element.
    const state = await page.evaluate(() => ({
      running: document.querySelector('[data-testid="export-running"]')?.textContent ?? '',
      succeeded: document.querySelector('[data-testid="export-succeeded"]') !== null,
      failed: document.querySelector('[data-testid="export-failed"]') !== null,
    }));
    // The encoding phase shows "%N · done/total kare"; preparing does not.
    if (/\d+\/\d+ kare/.test(state.running)) sawEncoding = true;
    if (state.succeeded) return { end: 'succeeded' as const, sawEncoding };
    if (state.failed) return { end: 'failed' as const, sawEncoding };
    await page.waitForTimeout(100);
  }
  return { end: 'timeout' as const, sawEncoding };
}

test.describe('download wording', () => {
  test('the button, the dialog and the final action say it is a download to this computer', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId('open-export')).toHaveText(/Videoyu indir/);
    await openVideo(page, SAMPLE_VIDEO);
    await expect(page.getByTestId('timeline-output-hint')).toHaveText(
      'İndirilen video, zaman çizgisindeki parçalardan oluşur.',
    );

    await page.getByTestId('open-export').click();
    await expect(page.getByRole('dialog', { name: 'Videoyu indir' })).toBeVisible();
  });
});

test.describe('memory route: at most 5 minutes (doc 15 v3)', () => {
  test.beforeEach(async ({ page }) => {
    // Behave like a browser without OPFS sync access (test hook, see exportClient).
    await page.addInitScript(() => {
      (window as unknown as { __clipForceMemoryRoute: boolean }).__clipForceMemoryRoute = true;
    });
  });

  test('a 5:10 output is refused before any frame is encoded, with the reason', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await openEditor(page);
    await openVideo(page, timelineFixture('long').file);
    await expect(page.getByTestId('output-summary')).toHaveText('1 parça · 5:10 dk');

    await openExportReady(page);
    const run = await runUntilEnd(page);
    expect(run.end).toBe('failed');
    expect(run.sawEncoding).toBe(false);
    await expect(page.getByTestId('export-failed')).toContainText(
      'Bu tarayıcı videoyu diske yazamıyor; burada en fazla 5 dakikalık video indirilebilir.',
    );
    // ADR-021: the same sentence as the 60-minute gate, with this route's cap.
    await expect(page.getByTestId('export-failed-over-limit')).toHaveText(
      'Sonuç 5:10. İndirmek için en az 0:10 sil — sınır 5 dakika.',
    );
    expect(await listExportFiles(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a short output still downloads through memory, and says so', async ({ page }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    await openVideo(page, SAMPLE_VIDEO);
    // Keep it short: the first 3 seconds.
    await page.getByTestId('undo').click();
    await page.getByTestId('range-start').fill('00:00.000');
    await page.getByTestId('range-end').fill('00:03.000');
    await page.getByTestId('add-moment').click();

    await openExportReady(page);
    const run = await runUntilEnd(page);
    expect(run.end).toBe('succeeded');
    await expect(page.getByTestId('measured-route')).toHaveText('bellek');
    const save = page.getByTestId('export-download');
    await expect(save).toHaveText(/Bilgisayara kaydet/);
    const download = page.waitForEvent('download');
    await save.click();
    expect((await download).suggestedFilename()).toMatch(/\.mp4$/);
  });
});

test.describe('storage estimate: refused up front when the file will not fit', () => {
  test('a long output with too little quota is refused; a short one still works', async ({ page }) => {
    test.setTimeout(240_000);
    // 40 MB free, as the worker's storage estimate will report it (test hook,
    // see exportClient). Chromium's CDP quota override did not reach
    // navigator.storage.estimate() in Playwright's browser, so a real quota
    // could not be shrunk here.
    await page.addInitScript(() => {
      (window as unknown as { __clipStorageFreeBytes: number }).__clipStorageFreeBytes = 40 * 1024 * 1024;
    });
    await openEditor(page);

    await openVideo(page, timelineFixture('long').file);
    await openExportReady(page);
    const long = await runUntilEnd(page);
    expect(long.end).toBe('failed');
    expect(long.sawEncoding).toBe(false);
    await expect(page.getByTestId('export-failed')).toContainText(
      'Bu uzunlukta bir video için tarayıcının kullanabileceği boş disk alanı yetmiyor.',
    );
    expect(await listExportFiles(page)).toEqual([]);
    await page.keyboard.press('Escape');

    // The same quota is plenty for a few seconds of video.
    await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByTestId('source-meta')).toContainText('sample-24s.mp4');
    await page.getByTestId('undo').click();
    await page.getByTestId('range-start').fill('00:00.000');
    await page.getByTestId('range-end').fill('00:03.000');
    await page.getByTestId('add-moment').click();
    await openExportReady(page);
    const short = await runUntilEnd(page);
    expect(short.end).toBe('succeeded');
    await expect(page.getByTestId('measured-route')).toHaveText('tarayıcının geçici diski');
  });
});

test.describe('the frame follows the opened video', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('portrait → 9:16 with a notice; one import undo restores the old frame', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    // A fresh project starts at 16:9.
    await expect(page.getByTestId('aspect-16-9')).toHaveAttribute('aria-pressed', 'true');

    await openVideo(page, timelineFixture('portrait').file);
    await expect(page.getByTestId('aspect-9-16')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-aspect', '9:16');
    await expect(page.getByTestId('timeline-notice')).toContainText('Dikey video: çerçeve 9:16 seçildi');
    await expect(page.getByTestId('timeline-notice')).toContainText('tek parça olarak eklendi');

    // First undo: the automatic piece. The frame belongs to the import.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('strip-clip')).toHaveCount(0);
    await expect(page.getByTestId('aspect-9-16')).toHaveAttribute('aria-pressed', 'true');
    // Second undo: the import itself, frame included.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('aspect-16-9')).toHaveAttribute('aria-pressed', 'true');
  });

  test('landscape → 16:9; replacing it with a portrait video switches to 9:16', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await page.getByTestId('aspect-1-1').click();
    await openVideo(page, SAMPLE_VIDEO);
    await expect(page.getByTestId('aspect-16-9')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('timeline-notice')).toContainText('Yatay video: çerçeve 16:9 seçildi');

    await page.getByTestId('video-input').setInputFiles(timelineFixture('portrait').file);
    await expect(page.getByTestId('source-meta')).toContainText('portrait-110s.mp4');
    await expect(page.getByTestId('aspect-9-16')).toHaveAttribute('aria-pressed', 'true');
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
    await expect(page.getByTestId('aspect-9-16')).toHaveAttribute('aria-pressed', 'true');
    // The user overrides the automatic choice.
    await page.getByTestId('aspect-1-1').click();
    await expect(page.getByTestId('save-state')).toContainText('Kaydedildi', { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('aspect-1-1')).toHaveAttribute('aria-pressed', 'true');

    // Re-linking the same file restores access; it is not a new import.
    await page.getByTestId('relink-video-input').setInputFiles(timelineFixture('portrait').file);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('aspect-1-1')).toHaveAttribute('aria-pressed', 'true');
  });
});
