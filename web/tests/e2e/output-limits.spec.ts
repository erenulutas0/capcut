import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

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
import { maxVideoBitrateForFileLimit } from '../../src/domain/outputStorage';
import { US_PER_SECOND } from '../../src/domain/time';

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
    // Both numbers, so the user knows how much to free (ADR-023), in decimal
    // MB (ADR-030): 40 MiB free is 41 943 040 bytes, "41,9 MB" rounded down.
    await expect(page.getByTestId('export-failed-storage')).toHaveText(
      /^Bu video için gereken boş alan: \d+(,\d)? MB\. Tarayıcının bildirdiği boş alan: 41,9 MB\.$/,
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

const MIB = 1024 * 1024;
/** What the export claims up front in the "fills up mid-file" tests (test hook `__clipStorageReserveBytes`). */
const SMALL_CLAIM_BYTES = MIB;
/** Room left above what the origin already holds in those tests: the claim fits, the 5:10 file does not. */
const ROOM_FOR_PARTIAL_FILE_BYTES = 2 * MIB;

/**
 * A quota with exactly `roomBytes` of room left, whatever the origin already
 * stores. The quota covers everything of the origin — the app's offline copy
 * (Cache Storage, filled by the service worker after the first load) and the
 * stored project — and that grows with every page the app gains: a fixed
 * number here used to leave less room than the claim once the offline copy
 * passed 2 MB (and would silently leave more than the file once it shrank).
 * So: wait until the offline copy is complete and the usage stands still,
 * then put the quota that far above it.
 */
async function limitRoom(page: Page, roomBytes: number): Promise<{ usage: number; quota: number }> {
  // Without an offline copy in the build there is nothing to wait for; then the usage is simply small.
  await page.evaluate(
    () =>
      Promise.race([
        navigator.serviceWorker?.ready ?? Promise.resolve(null),
        new Promise((resolve) => window.setTimeout(resolve, 15_000)),
      ]),
  );
  const usageNow = () => page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);
  let usage = await usageNow();
  await expect
    .poll(
      async () => {
        const before = usage;
        usage = await usageNow();
        return usage === before;
      },
      { intervals: [750], timeout: 30_000, message: 'the storage usage of the origin never stood still' },
    )
    .toBe(true);
  // Nothing of an earlier test is in the way (the temp files are the only thing that could be big).
  expect(await exportFiles(page)).toEqual([]);
  const quota = usage + roomBytes;
  await limitQuota(page, quota);
  return { usage, quota };
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
      /Bu video için gereken boş alan: \d+(,\d)? MB\. Tarayıcı bu kadar yeri diskte ayıramadı/,
    );
    // The browser's own disk: a video of up to 5 minutes still goes through memory (doc 15 v3), and
    // 64 MB holds less than that here, so 5 minutes is the honest length to suggest.
    await expect(page.getByTestId('export-failed-reason')).toHaveText(
      'Bu uzunlukta bir video için boş disk alanı yetmiyor. Diskte yer aç ya da en fazla 5 dakikalık bir kesit indir; hiçbir kare kodlanmadı.',
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
    // 17 Oct 2026: the disk is asked again in smaller steps, so the line says how much it does have.
    await expect(page.getByTestId('export-failed-storage')).toHaveText(
      /^Seçtiğin yerde bu video için yaklaşık \d+(,\d)? MB boş yer gerekiyor; o diskte yalnızca yaklaşık \d+(,\d)? MB var\./,
    );
    // The empty file the dialog created is removed again.
    await expect.poll(() => opfsFiles(page)).toEqual({});
    expect(errors).toEqual([]);
  });

  test('a disk that fills up mid-file ends in an honest failure; the partial file is deleted', async ({ page }) => {
    test.setTimeout(240_000);
    await noSavePicker(page);
    // Claim only 1 MiB up front (test hook), so the file must grow past the
    // 2 MiB of room that is left and the browser's own write refusal ends the
    // export. The room is measured from what the origin holds now (limitRoom),
    // not a fixed quota: the app's offline copy shares it and keeps growing.
    await page.addInitScript((claim) => {
      (window as unknown as { __clipStorageReserveBytes: number }).__clipStorageReserveBytes = claim;
    }, SMALL_CLAIM_BYTES);
    const errors = await openEditor(page);
    expect(ROOM_FOR_PARTIAL_FILE_BYTES).toBeGreaterThan(SMALL_CLAIM_BYTES);
    await limitRoom(page, ROOM_FOR_PARTIAL_FILE_BYTES);
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
    await page.addInitScript((claim) => {
      (window as unknown as { __clipStorageReserveBytes: number }).__clipStorageReserveBytes = claim;
    }, SMALL_CLAIM_BYTES);
    const errors = await openEditor(page);
    // The claim fits in the room that is left; the file does not (see limitRoom).
    expect(ROOM_FOR_PARTIAL_FILE_BYTES).toBeGreaterThan(SMALL_CLAIM_BYTES);
    await limitRoom(page, ROOM_FOR_PARTIAL_FILE_BYTES);
    await openVideo(page, timelineFixture('long').file);
    await quality720(page);
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('failed');
    // Encoding began, so the claim was granted: the refusal came from a later write.
    expect(run.sawEncoding).toBe(true);
    await expect(page.getByTestId('export-failed')).toContainText('diskte yer kalmadı');
    await expect(page.getByTestId('download-saved')).toHaveCount(0);
    await expect.poll(() => opfsFiles(page)).toEqual({});
    expect(errors).toEqual([]);
  });
});

test.describe('not enough space: the length said is the length that fits (17 Oct 2026)', () => {
  test('the picked file: the refusal names a length from the real free space, and a kesit that long downloads', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await installSavePicker(page);
    const errors = await openEditor(page);
    // Room for about two minutes of this video, not for all 5:10 (and not for "5 minutes" either).
    await limitRoom(page, 62 * MIB);
    await openVideo(page, timelineFixture('long').file);
    await quality720(page);
    const refused = await downloadUntilEnd(page);
    expect(refused.end).toBe('failed');
    expect(refused.sawEncoding).toBe(false);
    const reason = (await page.getByTestId('export-failed-reason').textContent()) ?? '';
    const said = /en fazla (\d+) dakikalık bir kesit indir/.exec(reason);
    expect(said, reason).not.toBeNull();
    const minutes = Number(said![1]);
    expect(minutes).toBeGreaterThanOrEqual(1);
    expect(minutes).toBeLessThan(5);
    await expect.poll(() => opfsFiles(page)).toEqual({});

    // The same disk, a kesit exactly that long: it fits.
    await addKesit(page, '0', String(minutes * 60));
    const fits = await downloadUntilEnd(page);
    expect(fits.end).toBe('succeeded');
    await expect(page.getByTestId('download-saved')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('the largest download: 4 GiB - 1 byte, never more (17 Oct 2026)', () => {
  const sixSeconds = 6 * US_PER_SECOND;

  test('an output whose estimate would pass the limit is encoded at a held bitrate and stays under it', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // A small limit (measurement hook) holds a six-second kesit the way 60 minutes are held by the real one.
    const limit = 33 * MIB;
    await page.addInitScript((value) => {
      const holder = window as unknown as { __clipOutputLimitBytes: number; __clipExportMode: string };
      holder.__clipOutputLimitBytes = value;
      holder.__clipExportMode = 'encode';
    }, limit);
    await noSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, SAMPLE_VIDEO);
    await addKesit(page, '0', '6');
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('succeeded');
    const method = page.getByTestId('export-method');
    await expect(method).toHaveAttribute('data-file-limit-held', 'true');
    const expected = maxVideoBitrateForFileLimit({ audioBitrate: 128_000, durationUs: sixSeconds }, limit);
    expect(Number(await method.getAttribute('data-video-bitrate'))).toBe(expected);
    const sizes = Object.values(await opfsFiles(page));
    expect(sizes).toHaveLength(1);
    expect(sizes[0]).toBeLessThanOrEqual(limit);
    expect(errors).toEqual([]);
  });

  test('without the hook a short kesit is not held', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      (window as unknown as { __clipExportMode: string }).__clipExportMode = 'encode';
    });
    await noSavePicker(page);
    await openEditor(page);
    await openVideo(page, SAMPLE_VIDEO);
    await addKesit(page, '0', '6');
    expect((await downloadUntilEnd(page)).end).toBe('succeeded');
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-file-limit-held', 'false');
  });

  test('a file that still grows past the limit is stopped there, honestly, and nothing is left', async ({ page }) => {
    test.setTimeout(180_000);
    // Under what even the lowest bitrate writes in six seconds: the copy is too big (so the full encode
    // runs), the held encode is too, and the disk route stops the file at the limit.
    await page.addInitScript(() => {
      (window as unknown as { __clipOutputLimitBytes: number }).__clipOutputLimitBytes = 150_000;
    });
    await noSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, SAMPLE_VIDEO);
    await addKesit(page, '0', '6');
    const run = await downloadUntilEnd(page);
    expect(run.end).toBe('failed');
    expect(run.sawEncoding).toBe(true);
    await expect(page.getByTestId('export-failed-reason')).toHaveText(
      'Video 4,29 GB’tan büyük olacaktı; LiloCut bu kadar büyük bir dosyayı yeniden açamaz. Yarım dosya silindi. Daha kısa bir kesit indir ya da Ayarlar’da “En çok 720p”yi seç.',
    );
    await expect(page.getByTestId('export-download')).toHaveCount(0);
    expect(await exportFiles(page)).toEqual([]);
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
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId('relink-video')).toBeVisible({ timeout: 20_000 });
    await aspectPressed(page, '1-1');
    await page.getByTestId('relink-video-input').setInputFiles(timelineFixture('portrait').file);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await aspectPressed(page, '1-1');
  });
});
