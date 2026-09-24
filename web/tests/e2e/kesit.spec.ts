import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  addKesit,
  closestSourceSecond,
  kesitRanges,
  noHorizontalOverflow,
  noSavePicker,
  openEditor,
  openSettings,
  closeSheet,
  opfsFiles,
  openVideo,
  pickerCalls,
  playheadTo,
  probeMp4,
  readSaved,
  sourceMs,
  installSavePicker,
} from './kesitFlow';
import { timelineFixture } from './timeline-media';

/**
 * The kesit editor (ADR-026), the founder's story: watch the video, mark
 * Başlangıç (I) and Bitiş (O), "Kesit ekle", and each kesit plays, downloads
 * straight into a file the user picks, or goes away with one press.
 *
 * Screenshots for the ADR are written only with KESIT_SHOTS=1, so a normal
 * run never writes tracked files.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const SHOTS = process.env.KESIT_SHOTS === '1';
const SHOT_DIR = join(process.cwd(), 'screenshots');

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOT_DIR, name), fullPage });
}

const card = (page: Page, index: number) => page.getByTestId('kesit-card').nth(index);

async function dragBy(page: Page, handle: Locator, dx: number, dy = 0) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

test.describe('kesit list: mark, add, play, download', () => {
  test.beforeEach(async ({ page }) => {
    await installSavePicker(page);
  });

  test('I / O on the video, "Kesit ekle", ▶ plays exactly the range, ⬇ writes it into the picked file', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const errors = await openEditor(page);
    await openVideo(page, SAMPLE);

    // Nothing is placed automatically: the list is empty, the top button
    // downloads the whole video.
    await expect(page.getByTestId('kesit-card')).toHaveCount(0);
    await expect(page.getByTestId('download-all')).toHaveText('Videoyu indir');
    await expect(page.getByTestId('timeline-notice')).toContainText('Video açıldı (24,0 sn)');

    // Mark on the video's own clock with the keyboard: 2 s → I, 6 s → O.
    await playheadTo(page, 2);
    await page.keyboard.press('i');
    await expect(page.getByTestId('range-start')).toHaveValue('00:02.000');
    await expect(page.getByTestId('strip-pending')).toBeVisible();
    await playheadTo(page, 6);
    await page.keyboard.press('o');
    await expect(page.getByTestId('range-end')).toHaveValue('00:06.000');
    await shot(page, 'kesit-list-marking-desktop.png');
    // Enter adds it (focus is on the strip's playhead, not on a button).
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    await expect(kesitRanges(page)).toHaveText(['00:02 → 00:06']);
    await expect(page.getByTestId('kesit-length')).toHaveText(['Süre 0:04']);
    await expect(page.getByTestId('moment-count')).toHaveText('(1)');
    await expect(page.getByTestId('strip-kesit')).toHaveCount(1);
    await expect(page.getByTestId('strip-pending')).toHaveCount(0);
    await expect(page.getByTestId('range-start')).toHaveValue('');
    await expect(page.getByTestId('timeline-notice')).toContainText('Kesit 1 eklendi: 00:02 → 00:06');
    await expect(page.getByTestId('download-all')).toHaveText('Kesiti indir');
    await expect(page.getByRole('button', { name: "Kesit 1'i indir, 00:02–00:06" })).toBeVisible();

    // ▶ jumps to the start and stops at the end, on its own.
    await playheadTo(page, 15);
    await card(page, 0).getByTestId('kesit-play').click();
    await expect.poll(() => sourceMs(page), { timeout: 5000 }).toBeGreaterThanOrEqual(2000);
    expect(await sourceMs(page)).toBeLessThan(6000);
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Oynat', { timeout: 15_000 });
    const stoppedAt = await sourceMs(page);
    expect(stoppedAt).toBeGreaterThanOrEqual(5900);
    expect(stoppedAt).toBeLessThanOrEqual(6100);

    // ⬇ opens the save dialog at once with a name, writes into that file,
    // and says where. No second "save" step.
    await card(page, 0).getByTestId('kesit-download').click();
    await expect(card(page, 0).getByTestId('download-saved')).toHaveText(
      'Kaydedildi: saved-sample-24s_00-02-00-06.mp4',
      { timeout: 120_000 },
    );
    expect(await pickerCalls(page)).toEqual(['sample-24s_00-02-00-06.mp4']);
    // Only the encode path exists in this build (the fast path reports its own).
    await expect(card(page, 0).getByTestId('export-method')).toHaveText('Kodlandı');
    await expect(page.getByTestId('export-download')).toHaveCount(0);
    await expect(card(page, 0).getByTestId('measured-route')).toHaveText('seçtiğin dosya');
    // Only the picked file: no temporary copy is left in OPFS.
    const files = await opfsFiles(page);
    expect(Object.keys(files)).toEqual(['saved-sample-24s_00-02-00-06.mp4']);

    const saved = await readSaved(page, testInfo, 'saved-sample-24s_00-02-00-06.mp4');
    const probe = probeMp4(saved);
    expect(probe.frames).toBe(120);
    expect(Math.abs(probe.durationS - 4)).toBeLessThanOrEqual(0.034);
    expect([probe.width, probe.height]).toEqual([1920, 1080]);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    // It shows the kesit's picture, not the start of the video.
    expect(closestSourceSecond(saved, 0.5, SAMPLE, [0.5, 2.5, 10.5, 18.5])).toBe(2.5);
    expect(closestSourceSecond(saved, 3.5, SAMPLE, [3.5, 5.5, 13.5, 20.5])).toBe(5.5);
    await shot(page, 'kesit-list-saved-desktop.png');
    expect(errors).toEqual([]);
  });

  test('two kesitler reordered, then "Hepsini birleştirip indir" joins them in list order', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await addKesit(page, '10', '12');
    await addKesit(page, '2', '4');
    await expect(kesitRanges(page)).toHaveText(['00:10 → 00:12', '00:02 → 00:04']);
    await expect(page.getByTestId('download-all')).toHaveText('Hepsini birleştirip indir');

    // Keyboard reorder: the grip moves the second kesit up.
    const grip = card(page, 1).getByTestId('kesit-grip');
    await grip.focus();
    await page.keyboard.press('ArrowUp');
    await expect(kesitRanges(page)).toHaveText(['00:02 → 00:04', '00:10 → 00:12']);
    await expect(page.getByTestId('kesit-move-status')).toHaveText('Kesit 2 artık 1. sırada.');
    await expect(card(page, 0).getByTestId('kesit-grip')).toBeFocused();

    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_2-kesit.mp4', {
      timeout: 120_000,
    });
    expect(await pickerCalls(page)).toEqual(['sample-24s_2-kesit.mp4']);
    const saved = await readSaved(page, testInfo, 'saved-sample-24s_2-kesit.mp4');
    const probe = probeMp4(saved);
    expect(probe.frames).toBe(120);
    expect(Math.abs(probe.durationS - 4)).toBeLessThanOrEqual(0.034);
    // List order: 2–4 first, then 10–12.
    expect(closestSourceSecond(saved, 0.5, SAMPLE, [2.5, 10.5])).toBe(2.5);
    expect(closestSourceSecond(saved, 2.5, SAMPLE, [2.5, 10.5])).toBe(10.5);
  });

  test('with no kesit the top button downloads the whole video', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await openSettings(page, 'frame');
    await page.getByTestId('export-quality').selectOption('720');
    await closeSheet(page);
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_tamami.mp4', {
      timeout: 200_000,
    });
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-sample-24s_tamami.mp4'));
    expect(probe.frames).toBe(720);
    expect([probe.width, probe.height]).toEqual([1280, 720]);
    // The whole video is not a kesit: the list stays empty.
    await expect(page.getByTestId('kesit-card')).toHaveCount(0);
  });

  test('closing the save dialog does nothing', async ({ page }) => {
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await addKesit(page, '1', '3');
    await page.evaluate(() => {
      (window as unknown as { __pickerMode: string }).__pickerMode = 'cancel';
    });
    await card(page, 0).getByTestId('kesit-download').click();
    await expect.poll(() => pickerCalls(page)).toEqual(['sample-24s_00-01-00-03.mp4']);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('download-running')).toHaveCount(0);
    await expect(page.getByTestId('download-status')).toHaveCount(0);
    await expect(card(page, 0).getByTestId('kesit-download')).toBeEnabled();
    expect(await opfsFiles(page)).toEqual({});
  });

  test('cancel while encoding leaves no file under the chosen name', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await addKesit(page, '0', '20');
    await card(page, 0).getByTestId('kesit-download').click();
    await expect(card(page, 0).getByTestId('download-running')).toBeVisible({ timeout: 30_000 });
    await expect(card(page, 0).getByTestId('download-file-name')).toHaveText('saved-sample-24s_00-00-00-20.mp4');
    await expect(card(page, 0).getByTestId('export-progress')).toHaveText(/%\d+/, { timeout: 60_000 });
    await card(page, 0).getByTestId('export-cancel').click();
    await expect(card(page, 0).getByTestId('export-canceled')).toContainText('yarım dosya bırakılmadı', {
      timeout: 60_000,
    });
    // The (empty) file the dialog created is removed again; nothing else is there.
    await expect.poll(() => opfsFiles(page)).toEqual({});
  });

  test('delete and undo; drag to reorder; the selected kesit is fine-tuned', async ({ page }) => {
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await addKesit(page, '1', '3');
    await addKesit(page, '5', '8');
    await addKesit(page, '12', '15');

    // ✕ deletes, one undo brings it back in the same place.
    await card(page, 1).getByTestId('kesit-delete').click();
    await expect(kesitRanges(page)).toHaveText(['00:01 → 00:03', '00:12 → 00:15']);
    await expect(page.getByTestId('timeline-notice')).toContainText('Kesit 2 silindi');
    await page.getByTestId('undo').click();
    await expect(kesitRanges(page)).toHaveText(['00:01 → 00:03', '00:05 → 00:08', '00:12 → 00:15']);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByTestId('kesit-card')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('kesit-card')).toHaveCount(3);

    // Pointer drag on the grip: the last kesit to the top.
    const lastGrip = card(page, 2).getByTestId('kesit-grip');
    const firstBox = await card(page, 0).boundingBox();
    const lastBox = await card(page, 2).boundingBox();
    await dragBy(page, lastGrip, 0, (firstBox?.y ?? 0) - (lastBox?.y ?? 0) - 10);
    await expect(kesitRanges(page)).toHaveText(['00:12 → 00:15', '00:01 → 00:03', '00:05 → 00:08']);
    await page.getByTestId('undo').click();
    await expect(kesitRanges(page)).toHaveText(['00:01 → 00:03', '00:05 → 00:08', '00:12 → 00:15']);

    // Selecting a card: the fields and I / O edit that kesit.
    await card(page, 1).getByTestId('kesit-select').click();
    await expect(card(page, 1).getByTestId('kesit-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('kesit-editing')).toContainText('Kesit 2 seçili');
    await expect(page.getByTestId('range-start')).toHaveValue('00:05.000');
    await expect.poll(() => sourceMs(page)).toBe(5000);
    await playheadTo(page, 9);
    await page.keyboard.press('o');
    await expect(kesitRanges(page).nth(1)).toHaveText('00:05 → 00:09');
    await page.getByTestId('range-start').fill('4');
    await page.getByTestId('range-start').press('Enter');
    await expect(kesitRanges(page).nth(1)).toHaveText('00:04 → 00:09');
    // A reversed range is refused and said.
    await playheadTo(page, 2);
    await page.keyboard.press('o');
    await expect(page.getByTestId('range-error')).toContainText('Bitiş zamanı başlangıçtan sonra olmalı');
    await expect(kesitRanges(page).nth(1)).toHaveText('00:04 → 00:09');

    // The strip handle drags the selected kesit's end, snapped to frames.
    const end = page.getByTestId('trim-end');
    await expect(end).toHaveAttribute('aria-label', 'Kesit 2 bitişi');
    const content = await page.getByTestId('strip-content').boundingBox();
    const pxPerSecond = (content?.width ?? 0) / 24;
    await dragBy(page, end, pxPerSecond * 2);
    await expect(kesitRanges(page).nth(1)).toHaveText(/00:04 → 00:1[01]/);
    // Keyboard on the handle: one frame per arrow.
    await end.focus();
    const before = Number(await end.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Number(await end.getAttribute('aria-valuenow'))).toBeCloseTo(before - 1 / 30, 3);

    // "Bitti" (or Escape) leaves the kesit; I / O mark a new one again.
    await page.getByTestId('kesit-done').click();
    await expect(page.getByTestId('kesit-editing')).toHaveCount(0);
    await expect(page.getByTestId('add-moment')).toBeVisible();
    await card(page, 0).getByTestId('kesit-select').click();
    await page.getByTestId('timeline-playhead').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('kesit-editing')).toHaveCount(0);
  });

  test('the strip zooms and keeps the playhead in view', async ({ page }) => {
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await expect(page.getByTestId('strip-zoom-value')).toContainText('×1');
    await expect(page.getByTestId('strip-zoom-out')).toBeDisabled();
    await page.getByTestId('strip-zoom-in').click();
    await expect(page.getByTestId('strip-zoom-value')).toContainText('×2');
    // 24 s video: at most 10 s across the strip, ×2.4.
    await page.getByTestId('strip-zoom-in').click();
    await expect(page.getByTestId('strip-zoom-value')).toContainText('×2.4');
    await expect(page.getByTestId('strip-zoom-in')).toBeDisabled();

    // End: the strip scrolls so the playhead stays visible.
    await page.getByTestId('timeline-playhead').focus();
    await page.keyboard.press('End');
    await expect
      .poll(async () => {
        const viewport = await page.getByTestId('strip-viewport').boundingBox();
        const knob = await page.getByTestId('timeline-playhead').boundingBox();
        return knob && viewport ? knob.x >= viewport.x && knob.x <= viewport.x + viewport.width : false;
      })
      .toBe(true);

    // Ctrl + wheel zooms out around the pointer.
    const viewport = await page.getByTestId('strip-viewport').boundingBox();
    await page.mouse.move((viewport?.x ?? 0) + 100, (viewport?.y ?? 0) + 40);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 2000);
    await page.keyboard.up('Control');
    await expect(page.getByTestId('strip-zoom-value')).toContainText('×1');
    await page.getByTestId('strip-zoom-in').click();
    await page.getByTestId('strip-zoom-fit').click();
    await expect(page.getByTestId('strip-zoom-value')).toContainText('×1');
  });

  test('⛶ and F watch the preview full screen with its own controls', async ({ page }) => {
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await page.getByTestId('fullscreen-toggle').click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') ?? null))
      .toBe('preview-wrap');
    await expect(page.getByTestId('fullscreen-controls')).toBeVisible();
    await expect(page.getByTestId('fullscreen-time')).toContainText('/ 00:24.000');
    await page.getByTestId('fullscreen-play').click();
    await expect.poll(() => sourceMs(page), { timeout: 5000 }).toBeGreaterThan(300);
    await page.getByTestId('fullscreen-play').click();
    await page.getByTestId('fullscreen-exit').click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(page.getByTestId('fullscreen-controls')).toHaveCount(0);

    // The F key toggles it too.
    await page.getByTestId('timeline-playhead').focus();
    await page.keyboard.press('f');
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') ?? null))
      .toBe('preview-wrap');
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  });

  test('without element full screen (iPhone Safari) the button is not shown', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
    });
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await expect(page.getByTestId('fullscreen-toggle')).toHaveCount(0);
  });
});

test.describe('browsers without the save dialog', () => {
  test('the proven route runs and the file is offered with "Bilgisayara kaydet"', async ({ page }) => {
    test.setTimeout(120_000);
    await noSavePicker(page);
    await openEditor(page);
    await openVideo(page, SAMPLE);
    await addKesit(page, '3', '5');
    await card(page, 0).getByTestId('kesit-download').click();
    const link = card(page, 0).getByTestId('export-download');
    await expect(link).toBeVisible({ timeout: 120_000 });
    await expect(card(page, 0).getByTestId('measured-route')).toHaveText('tarayıcının geçici diski');
    const download = page.waitForEvent('download');
    await link.click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe('sample-24s_00-03-00-05.mp4');
    const bytes = statSync(await saved.path()).size;
    await expect(card(page, 0).getByTestId('export-save-space')).toHaveText(
      `Kaydederken bilgisayarında yaklaşık ${Math.ceil(bytes / 1_048_576)} MiB daha boş yer gerekir.`,
    );
    expect(probeMp4(await saved.path()).frames).toBe(60);
  });
});

test.describe('limits per download (ADR-021 sentences, ADR-026)', () => {
  test('a kesit, the joined kesitler and the whole video over 60 minutes are refused before encoding', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await installSavePicker(page);
    const errors = await openEditor(page);
    const { file } = timelineFixture('ninety');
    await openVideo(page, file);

    // Whole video (no kesit): 90 minutes.
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('export-over-limit-text')).toHaveText(
      'Video 1:30:00. Tamamı indirilemez — sınır 60 dakika. Saklamak istediğin yerleri kesit olarak ekle ve kesitleri indir.',
    );
    await expect(page.getByTestId('export-report')).toHaveCount(0);

    // One kesit of 70 minutes: warned on the card, refused on ⬇.
    await addKesit(page, '0', '1:10:00');
    await expect(card(page, 0).getByTestId('kesit-over-limit')).toBeVisible();
    await card(page, 0).getByTestId('kesit-download').click();
    await expect(card(page, 0).getByTestId('export-over-limit-text')).toHaveText(
      'Kesit 1:10:00. İndirmek için en az 10:00 kısalt — sınır 60 dakika.',
    );

    // Two kesitler of 40 minutes joined: 80 minutes.
    await card(page, 0).getByTestId('kesit-delete').click();
    await addKesit(page, '0', '40:00');
    await addKesit(page, '50:00', '1:30:00');
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('export-over-limit-text')).toHaveText(
      'Kesitler birlikte 1:20:00. Birleştirip indirmek için en az 20:00 çıkar — sınır 60 dakika. Kesitleri tek tek de indirebilirsin.',
    );
    // No save dialog was opened for any refusal, nothing was written.
    expect(await pickerCalls(page)).toEqual([]);
    expect(await opfsFiles(page)).toEqual({});

    // Each kesit alone fits: the last 3 seconds of the long file download.
    await addKesit(page, '1:29:57', '1:30:00');
    await card(page, 2).getByTestId('kesit-download').click();
    await expect(card(page, 2).getByTestId('download-saved')).toBeVisible({ timeout: 180_000 });
    const [name] = await pickerCalls(page);
    expect(name).toBe('doksan-dakika_1-29-57-1-30-00.mp4');
    const probe = probeMp4(await readSaved(page, testInfo, `saved-${name}`));
    expect(Math.abs(probe.durationS - 3)).toBeLessThanOrEqual(0.034);
    expect(errors).toEqual([]);
  });

  test('a rejected file is named, the open video stays, the message can be closed', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await openVideo(page, timelineFixture('portrait').file);
    await addKesit(page, '5', '10');
    const { file } = timelineFixture('tooLong');
    await page.getByTestId('video-input').setInputFiles(file);
    const error = page.getByTestId('media-error');
    await expect(error).toHaveText(
      '“cok-uzun-video.mp4” açılamadı: video bu sürümdeki 120 dakika sınırının üzerinde. Açık olan videon değişmedi.',
      { timeout: 60_000 },
    );
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('source-meta')).toContainText('portrait-110s.mp4');
    await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    await page.getByTestId('media-error-dismiss').click();
    await expect(error).toHaveCount(0);

    // Shown again for another rejection, cleared by the next successful edit.
    await page.getByTestId('video-input').setInputFiles(file);
    await expect(error).toBeVisible({ timeout: 60_000 });
    await addKesit(page, '20', '25');
    await expect(page.getByTestId('kesit-card')).toHaveCount(2);
    await expect(error).toHaveCount(0);
  });

  test('without an open video the message does not claim one stayed open', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles({
      name: 'bozuk.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('not a real mp4'),
    });
    const error = page.getByTestId('media-error');
    await expect(error).toContainText('“bozuk.mp4” açılamadı: ');
    await expect(error).not.toContainText('değişmedi');
  });
});

test.describe('old projects and backups open as kesitler', () => {
  test('a backup of a project with the old automatic whole piece shows it as one kesit', async ({ page }) => {
    await installSavePicker(page);
    await openEditor(page);
    const size = statSync(SAMPLE).size;
    const now = new Date().toISOString();
    const record = {
      recordVersion: 1,
      projectId: 'p_old_whole_001',
      title: 'Eski proje',
      edl: {
        schemaVersion: 2,
        projectId: 'p_old_whole_001',
        revision: 2,
        assets: [
          { assetId: 'a_video_001', kind: 'video', durationUs: 24_000_000, displayWidth: 1280, displayHeight: 720, hasAudio: true },
        ],
        canvas: { aspect: '16:9', background: '#000000' },
        clips: [
          {
            clipId: 'c_001',
            assetId: 'a_video_001',
            sourceInUs: 0,
            sourceOutUs: 24_000_000,
            sourceGainDb: 0,
            muted: false,
            view: { x: 0, y: 0, width: 1, height: 1, fit: 'cover' },
          },
        ],
        export: {
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          shortEdge: 720,
          fpsNum: 30,
          fpsDen: 1,
          colorMode: 'sdr_rec709',
          audioSampleRate: 48000,
        },
        captionTracks: [],
      },
      bindings: [
        {
          assetId: 'a_video_001',
          kind: 'video',
          fileName: 'sample-24s.mp4',
          sizeBytes: size,
          lastModified: 0,
          durationUs: 24_000_000,
          displayWidth: 1280,
          displayHeight: 720,
          mimeType: 'video/mp4',
          fingerprint: 'fp_00000000',
          lastSeenAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await page.getByTestId('backup-input').setInputFiles({
      name: 'eski.clip.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(record)),
    });
    await expect(page.getByTestId('moment-count')).toHaveText('(1)', { timeout: 20_000 });
    await expect(kesitRanges(page)).toHaveText(['00:00 → 00:24']);
    await expect(page.getByTestId('download-all')).toHaveText('Kesiti indir');
    await page.getByTestId('relink-video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 30_000 });
    await expect(kesitRanges(page)).toHaveText(['00:00 → 00:24']);
    await expect(page.getByTestId('strip-kesit')).toHaveCount(1);
  });
});

test.describe('phone width (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('preview, strip, marks and the list stack; touch seeks and drags; Ayarlar is a sheet', async ({ page }) => {
    test.setTimeout(120_000);
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, SAMPLE);
    await noHorizontalOverflow(page);

    // Order down the page: preview, strip, marks, list.
    const top = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.y ?? -1;
    const order = [await top('preview-wrap'), await top('source-strip'), await top('mark-bar'), await top('kesit-panel')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // A tap on the strip seeks there.
    const client = await page.context().newCDPSession(page);
    const content = await page.getByTestId('strip-content').boundingBox();
    if (!content) throw new Error('strip not visible');
    const y = content.y + 50;
    const tapAt = async (x: number) => {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await tapAt(content.x + content.width / 2);
    await expect.poll(() => sourceMs(page)).toBeGreaterThan(10_000);
    await expect.poll(() => sourceMs(page)).toBeLessThan(14_000);

    await page.getByTestId('mark-start').click();
    await expect(page.getByTestId('strip-pending')).toBeVisible();
    // Drag the pending end handle by touch towards the end.
    const handle = await page.getByTestId('trim-end').boundingBox();
    if (!handle) throw new Error('handle not visible');
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hx, y: hy }] });
    for (let step = 1; step <= 8; step += 1) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: hx - step * 8, y: hy }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByTestId('range-end')).not.toHaveValue('');
    await page.getByTestId('add-moment').click();
    await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    await noHorizontalOverflow(page);

    // Ayarlar opens as a bottom sheet; Escape returns focus to its button.
    await page.getByTestId('open-settings').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(800);
    await expect(page.getByTestId('aspect-9-16')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('open-settings')).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'kesit-list-phone-390.png', true);
    expect(errors).toEqual([]);
  });
});
