import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { browserDecodesHevc, hevcFixture } from './hevc-media';
import {
  addKesit,
  installSavePicker,
  noSavePicker,
  openSettings,
  opfsFiles,
  pickerCalls,
  probeMp4,
  readSaved,
  sharedFiles,
  stubShare,
} from './kesitFlow';
import { silenceFixture } from './silence-media';
import { decodeMono, fileBytes, longNoisyFixture, noisyLongFixture, probeStreams } from './targetsize-media';
import { bandLuma, meanVolumeDb, wizardFixture } from './wizard-media';

/**
 * The task wizards (ADR-034), each from the opening screen to the saved file:
 * pick the task, pick the video, at most one choice, İndir. The save dialog
 * is the stand-in of kesitFlow.ts (a file in the page's own storage, written
 * through the same handle the real dialog returns); the saved file is read
 * back and measured with ffprobe / ffmpeg, tools that know nothing about our
 * encoder.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, H.264 + AAC, 24 s
const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4'); // 640×360, H.264 + AAC, 8 s
const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');

const title = (page: Page) => page.getByTestId('wizard-title');
const wizard = (page: Page) => page.getByTestId('wizard');

/** From the opening screen, the way a person does it: the card, then the video. */
async function startTask(page: Page, id: string, file: string) {
  await page.goto('/');
  await page.getByTestId(`task-${id}`).click();
  await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
}

async function download(page: Page) {
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
}

/** What the browser's project store holds (the editor's autosave): a wizard must leave it empty. */
function storedProjects(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => resolve(0);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve(0);
            return;
          }
          const count = db.transaction('projects', 'readonly').objectStore('projects').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            resolve(0);
          };
        };
      }),
  );
}

test.describe.configure({ timeout: 300_000 });
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await installSavePicker(page);
});

// ------------------------------------------------------------------ Kes

test.describe('Kes', () => {
  test('card → video → the kesit editor over that video, first-run hint showing; nothing is stored', async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startTask(page, 'kes', SAMPLE);

    // The editor, in place: the same file, no second dialog.
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/yap\/kes$/);
    await expect(page.getByTestId('source-meta')).toContainText('sample-24s.mp4');
    await expect(page.getByTestId('first-run-hint')).toBeVisible();
    await expect(page.getByTestId('first-run-hint')).toContainText('Nasıl kesilir?');
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');
    // It says that this work is not kept, instead of a save badge that never turns "saved".
    await expect(page.getByTestId('save-state-off')).toHaveText('Bu düzenleme saklanmıyor');
    await expect(page.getByTestId('save-state')).toHaveCount(0);

    // The kesit flow itself works as in /editor.
    await addKesit(page, '2', '4');
    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_00-02-00-04.mp4', {
      timeout: 120_000,
    });
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-sample-24s_00-02-00-04.mp4'));
    expect(probe.durationS).toBeCloseTo(2, 1);

    // Well past the editor's 500 ms autosave: no project was written.
    await page.waitForTimeout(1500);
    expect(await storedProjects(page)).toBe(0);

    // The wordmark leads back to the opening screen.
    await page.getByTestId('home-link').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
    expect(errors).toEqual([]);
  });

  test('a project kept by /editor is not replaced by work started from the opening screen', async ({ page }) => {
    await page.goto('/editor');
    await page.getByTestId('video-input').setInputFiles(OTHER);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await addKesit(page, '1', '3');
    await expect(page.getByTestId('save-state')).toContainText('Düzenleme saklandı', { timeout: 15_000 });

    await startTask(page, 'kes', SAMPLE);
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await addKesit(page, '10', '12');
    await addKesit(page, '14', '16');
    await page.waitForTimeout(1500);

    // The editor still has its own project: one kesit of the other video, waiting for its file.
    await page.goto('/editor');
    await expect(page.getByTestId('kesit-range')).toHaveText(['00:01 → 00:03']);
    await expect(page.getByText('other-8s.mp4').first()).toBeVisible();
  });
});

// ------------------------------------------------------------------ Boşlukları at

test.describe('Boşlukları at', () => {
  test('finds the gap, says how much shorter the video gets, saves the joined rest', async ({ page }, testInfo) => {
    const { file } = silenceFixture('bursts'); // 4.5 s; one 1.2 s gap → 0.9 s removed
    await startTask(page, 'bosluk', file);
    await expect(page.getByTestId('bosluk-summary')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText('Sessiz yerleri atalım');
    await expect(title(page)).toBeFocused();
    await expect(page.getByTestId('wizard-step')).toContainText('Boşlukları at · Adım 2 / 3');
    await expect(page.getByTestId('bosluk-found')).toHaveText('1 sessiz yer bulundu.');
    await expect(page.getByTestId('bosluk-shorter')).toHaveText('Videon kısalacak: 4,5 sn → 3,6 sn');
    // One decision, the default already chosen.
    await expect(page.getByTestId('option-long')).toBeChecked();
    await expect(page.getByTestId('option-short')).not.toBeChecked();
    await expect(page.getByTestId('bosluk-limit')).toHaveCount(0);

    await download(page);
    expect(await pickerCalls(page)).toEqual(['bursts_bosluksuz.mp4']);
    await expect(title(page)).toHaveText('Kaydedildi');
    await expect(page.getByTestId('wizard-step')).toContainText('Adım 3 / 3');
    await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-bursts_bosluksuz.mp4');
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-bursts_bosluksuz.mp4'));
    expect(probe.durationS).toBeGreaterThan(3.5);
    expect(probe.durationS).toBeLessThan(3.7);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    expect(await storedProjects(page)).toBe(0);
  });

  test('the one choice: “Kısa duraksamalar da” removes more; the editor opens with the same cuts as kesitler', async ({
    page,
  }) => {
    const { file } = silenceFixture('showcase'); // 12 s; gaps of 1.0, 0.3, 0.5 and 1.5 s
    await startTask(page, 'bosluk', file);
    await expect(page.getByTestId('bosluk-found')).toHaveText('2 sessiz yer bulundu.', { timeout: 60_000 });
    const long = await page.getByTestId('bosluk-shorter').textContent();

    await page.getByTestId('option-short').check();
    await expect(page.getByTestId('bosluk-found')).toHaveText('3 sessiz yer bulundu.');
    const short = await page.getByTestId('bosluk-shorter').textContent();
    expect(short).not.toBe(long);

    // "Daha fazla ayar → editörde aç": the three cuts are four kesitler there, no second file dialog.
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await expect(page.getByTestId('source-meta')).toContainText('showcase.mp4');
    await expect(page.getByTestId('kesit-card')).toHaveCount(4);
    await expect(page.getByTestId('download-all')).toContainText('Hepsini birleştirip indir');
    // One undo step takes the cuts back, as in the editor's own dialog.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('kesit-card')).toHaveCount(0);
  });

  test('nothing long enough: says so, İndir cannot be pressed, the other choice and the editor are offered', async ({
    page,
  }) => {
    await startTask(page, 'bosluk', wizardFixture('shortGaps'));
    await expect(page.getByTestId('bosluk-none')).toHaveText('Sessiz yer bulunamadı.', { timeout: 60_000 });
    await expect(page.getByTestId('bosluk-summary')).toContainText('İstersen editörde kendin kesebilirsin.');
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    await expect(page.getByTestId('wizard-open-editor')).toBeVisible();
    // No success, no file: nothing was asked of the save dialog.
    expect(await pickerCalls(page)).toEqual([]);

    await page.getByTestId('option-short').check();
    await expect(page.getByTestId('bosluk-found')).toContainText('sessiz yer bulundu.');
    await expect(page.getByTestId('wizard-download')).toBeEnabled();
  });

  test('more gaps than 20 pieces allow: says the limit plainly and keeps to it', async ({ page }, testInfo) => {
    const { file } = silenceFixture('many'); // 41 s: 1 s tone, 1 s silence — 20 inner gaps, 21 pieces
    await startTask(page, 'bosluk', file);
    await expect(page.getByTestId('bosluk-limit')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('bosluk-found')).toHaveText('20 sessiz yer bulundu.');
    await expect(page.getByTestId('bosluk-limit')).toHaveText(
      'Bir videoda en çok 20 parça birleştirilebiliyor. En uzun 19 boşluk atılacak; 1 kısa boşluk yerinde kalacak.',
    );
    await download(page);
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-many-gaps_bosluksuz.mp4'));
    // 41 s minus 19 gaps of 0.7 s (1 s less the 150 ms kept on each side).
    expect(probe.durationS).toBeGreaterThan(41 - 19 * 0.7 - 0.3);
    expect(probe.durationS).toBeLessThan(41 - 19 * 0.7 + 0.3);

    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('kesit-card')).toHaveCount(20);
  });

  test('a video without sound, and one where speech and noise cannot be told apart: said, not faked', async ({ page }) => {
    await startTask(page, 'bosluk', wizardFixture('noAudio'));
    await expect(page.getByTestId('bosluk-problem')).toContainText('Bu videoda ses yok; sessizlik aranamaz.', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('wizard-download')).toHaveCount(0);
    await expect(page.getByTestId('bosluk-retry')).toHaveCount(0);
    await expect(page.getByTestId('bosluk-open-editor')).toBeVisible();

    await page.getByTestId('video-input').setInputFiles(silenceFixture('lowContrast').file);
    await expect(page.getByTestId('bosluk-unclear')).toContainText('konuşma ile sessizlik ayırt edilemedi', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('wizard-download')).toHaveCount(0);
    await page.getByTestId('bosluk-open-editor').click();
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await expect(page.getByTestId('source-meta')).toContainText('low-contrast.mp4');
  });
});

// ------------------------------------------------------------------ Dikey yap

test.describe('Dikey yap', () => {
  test('“Doldur” by default: 1080 × 1920, the frame filled', async ({ page }, testInfo) => {
    await startTask(page, 'dikey', OTHER);
    await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText('Dikey yapalım');
    await expect(page.getByTestId('option-cover')).toBeChecked();
    // The live preview is the 9:16 frame, filled.
    const frame = page.getByTestId('wizard-preview-frame');
    await expect(frame).toHaveAttribute('data-fit', 'cover');
    const box = await frame.boundingBox();
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(9 / 16, 1);
    expect(await page.getByTestId('wizard-video').evaluate((video) => getComputedStyle(video).objectFit)).toBe('cover');

    await download(page);
    expect(await pickerCalls(page)).toEqual(['other-8s_dikey.mp4']);
    const saved = await readSaved(page, testInfo, 'saved-other-8s_dikey.mp4');
    const probe = probeMp4(saved);
    expect([probe.width, probe.height]).toEqual([1080, 1920]);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.durationS).toBeCloseTo(8, 1);
    // Filled: the top of the frame is picture, not a black bar.
    expect(bandLuma(saved, 1, { y: 0, height: 300 })).toBeGreaterThan(40);
    expect(await storedProjects(page)).toBe(0);
  });

  test('“Sığdır”: the whole picture with bars above and below; the editor opens with the same frame', async ({
    page,
  }, testInfo) => {
    await startTask(page, 'dikey', OTHER);
    await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('option-contain').check();
    await expect(page.getByTestId('wizard-preview-frame')).toHaveAttribute('data-fit', 'contain');
    expect(await page.getByTestId('wizard-video').evaluate((video) => getComputedStyle(video).objectFit)).toBe('contain');

    await download(page);
    const saved = await readSaved(page, testInfo, 'saved-other-8s_dikey.mp4');
    const probe = probeMp4(saved);
    expect([probe.width, probe.height]).toEqual([1080, 1920]);
    // 16:9 inside 1080 × 1920 is 1080 × 608 in the middle: black above, picture at the centre.
    expect(bandLuma(saved, 1, { y: 0, height: 300 })).toBeLessThan(24);
    expect(bandLuma(saved, 1, { y: 760, height: 400 })).toBeGreaterThan(40);

    // The hand-off: same video, 9:16, "Tam görüntüyü göster" already chosen.
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-aspect', '9:16');
    await expect(page.getByTestId('source-meta')).toContainText('other-8s.mp4');
    await openSettings(page, 'frame');
    await expect(page.getByTestId('aspect-9-16')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('fit-contain')).toBeChecked();
  });

  test('a video that is already 9:16 is told so, and there is nothing to choose', async ({ page }, testInfo) => {
    await startTask(page, 'dikey', wizardFixture('vertical'));
    await expect(page.getByTestId('dikey-already')).toHaveText(
      'Bu video zaten dikey: görüntü aynı kalır, 1080 × 1920 olarak kaydedilir.',
      { timeout: 60_000 },
    );
    await expect(page.getByTestId('dikey-choice')).toHaveCount(0);
    await download(page);
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-dikey-telefon_dikey.mp4'));
    expect([probe.width, probe.height]).toEqual([1080, 1920]);
  });
});

// ------------------------------------------------------------------ Müzik ekle

test.describe('Müzik ekle', () => {
  test('video → music → İndir: the music is in the file; without music İndir waits', async ({ page }, testInfo) => {
    await startTask(page, 'muzik', OTHER);
    await expect(page.getByTestId('muzik-pick')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText('Müzik ekleyelim');
    // No music yet: the button says why it waits.
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    await expect(page.getByTestId('wizard-blocked')).toHaveText('Önce müziğini seç.');
    await expect(page.getByTestId('option-keep')).toBeChecked();

    await page.getByTestId('audio-input').setInputFiles(MUSIC);
    await expect(page.getByTestId('muzik-name')).toHaveText('tone-30s.m4a');
    await expect(page.getByTestId('muzik-length-note')).toHaveText('Müzik videonun sonunda yavaşça kısılır.');
    await expect(page.getByTestId('wizard-blocked')).toHaveCount(0);

    // "Kapansın": only the music is heard.
    await page.getByTestId('option-mute').check();
    await download(page);
    expect(await pickerCalls(page)).toEqual(['other-8s_muzikli.mp4']);
    const saved = await readSaved(page, testInfo, 'saved-other-8s_muzikli.mp4');
    const probe = probeMp4(saved);
    expect(probe.audioCodec).toBe('aac');
    expect(probe.durationS).toBeCloseTo(8, 1);
    // 640 × 360 is not blown up to Full HD: the smaller of the two sizes.
    expect([probe.width, probe.height]).toEqual([1280, 720]);
    // The video's own sound is off, so what is heard is the music: clearly not silence.
    expect(meanVolumeDb(saved)).toBeGreaterThan(-40);
    // …and it is heard to the end: in each of the eight seconds (the last one fades out), not only at the start.
    const sound = decodeMono(saved);
    const levels = Array.from({ length: 8 }, (_, second) => {
      const from = second * 48_000 + 4_800;
      let energy = 0;
      for (let i = from; i < from + 24_000; i += 1) energy += (sound[i] ?? 0) ** 2;
      return Math.sqrt(energy / 24_000);
    });
    expect(levels.map((level) => level > 0.01), `music level per second: ${levels.map((level) => level.toFixed(3)).join(' ')}`).toEqual(
      Array.from({ length: 8 }, () => true),
    );
    expect(await storedProjects(page)).toBe(0);

    // The hand-off keeps both files and the choice. No kesit was made on the way: the editor has
    // the whole video ("Videoyu indir") with the music under all of it (8 s of the 30 s file).
    await page.getByTestId('wizard-open-editor').click();
    await expect(page.getByTestId('kesit-card')).toHaveCount(0);
    await expect(page.getByTestId('download-all')).toHaveText('Videoyu indir');
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-out')).toHaveValue('00:08.000');
    await expect(page.getByTestId('music-file-name')).toContainText('tone-30s.m4a');
    await expect(page.getByTestId('clip-mute')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('music-gain')).toHaveValue('0');
  });

  test('the defaults: music quietly behind the video’s own sound, full level when that sound is off', async ({ page }) => {
    await startTask(page, 'muzik', OTHER);
    await page.getByTestId('audio-input').setInputFiles(MUSIC);
    await expect(page.getByTestId('muzik-picked')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('option-mute').check();
    await page.getByTestId('option-keep').check();
    await page.getByTestId('wizard-open-editor').click();
    await openSettings(page, 'audio');
    await expect(page.getByTestId('clip-mute')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('music-gain')).toHaveValue('-12');
  });

  test('a file that is not music is refused with the editor’s sentence; the video stays', async ({ page }) => {
    await startTask(page, 'muzik', OTHER);
    await expect(page.getByTestId('muzik-pick')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('audio-input').setInputFiles({
      name: 'liste.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('bu bir ses dosyası değil'),
    });
    await expect(page.getByTestId('media-error')).toContainText('“liste.txt” açılamadı');
    await expect(page.getByTestId('wizard-video-name')).toHaveText('other-8s.mp4');
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
  });
});

// ------------------------------------------------------------------ Her yerde açılsın

test.describe('Her yerde açılsın', () => {
  test('no decision: an MP4 that already plays everywhere is told so, and saved as it is', async ({ page }, testInfo) => {
    await startTask(page, 'cevir', SAMPLE);
    await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText('Her yerde açılan bir video yapalım');
    await expect(page.getByTestId('cevir-info')).toContainText('iPhone, HEVC ya da HDR videolar her cihazda açılan MP4 olur.');
    // No choice on this step: no radio button, one primary button.
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByTestId('cevir-already')).toContainText('Bu video zaten her cihazda açılan türde.', {
      timeout: 60_000,
    });

    await download(page);
    expect(await pickerCalls(page)).toEqual(['sample-24s_uyumlu.mp4']);
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-sample-24s_uyumlu.mp4'));
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    // Its own frame and size: 720p stays 720p.
    expect([probe.width, probe.height]).toEqual([1280, 720]);
    expect(probe.durationS).toBeCloseTo(24, 1);
    // And the result says how it was made: the pictures were kept, not re-encoded.
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-method', 'copy');
  });

  test('a WebM (VP9 + Opus) becomes H.264 + AAC in an MP4; no “already fine” note', async ({ page }, testInfo) => {
    await startTask(page, 'cevir', wizardFixture('webm'));
    await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
    await download(page);
    await expect(page.getByTestId('cevir-already')).toHaveCount(0);
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-tarayici-kaydi_uyumlu.mp4'));
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    // 640 × 360 is under the smaller of the two sizes: saved as 720p.
    expect([probe.width, probe.height]).toEqual([1280, 720]);
    expect(probe.durationS).toBeCloseTo(2, 1);
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-method', 'encode');
  });

  test('an HEVC video: converted where the browser can read it, refused with the reason where it cannot', async ({
    page,
  }, testInfo) => {
    await page.goto('/yap/cevir');
    const decodes = await browserDecodesHevc(page);
    await page.getByTestId('video-input').setInputFiles(hevcFixture());
    if (!decodes) {
      // Playwright's Chromium has no HEVC decoder: an honest refusal, no wizard step that cannot work.
      await expect(page.getByTestId('media-error')).toContainText('“telefon-hevc.mp4” açılamadı', { timeout: 60_000 });
      await expect(page.getByTestId('media-error-hint')).toBeVisible();
      await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
      await expect(page.getByTestId('wizard-download')).toHaveCount(0);
      return;
    }
    await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
    await download(page);
    await expect(page.getByTestId('cevir-already')).toHaveCount(0);
    const probe = probeMp4(await readSaved(page, testInfo, 'saved-telefon-hevc_uyumlu.mp4'));
    expect(probe.videoCodec).toBe('h264');
  });
});

// ------------------------------------------------------------------ the frame every wizard shares

// ------------------------------------------------------------------ Küçült (ADR-035)

test.describe('Küçült', () => {
  const hint = (page: Page, id: string) => page.getByTestId(`size-hint-${id}`);
  /** Every option has said what it would give. */
  async function hintsReady(page: Page) {
    for (const id of ['share', 'email', 'whatsapp']) {
      await expect(hint(page, id)).not.toHaveAttribute('data-state', 'pending', { timeout: 60_000 });
    }
  }

  test('one choice, each option says its outcome first; WhatsApp: the saved file is under 16 MB and says its real size', async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const source = noisyLongFixture();
    // About 21 MB: over WhatsApp's limit, under the other two.
    expect(fileBytes(source)).toBeGreaterThan(16_000_000);
    expect(fileBytes(source)).toBeLessThan(25_000_000);
    await startTask(page, 'kucult', source);
    await expect(page.getByTestId('kucult-choice')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText('Videonu küçültelim');
    await expect(page.getByRole('radio')).toHaveCount(3);
    await expect(page.getByTestId('option-share')).toBeChecked();
    await expect(page.getByTestId('kucult-choice')).toContainText('Paylaşmak için (52 MB altı)');
    await expect(page.getByTestId('kucult-choice')).toContainText('E-posta (25 MB altı)');
    await expect(page.getByTestId('kucult-choice')).toContainText('WhatsApp (16 MB altı)');
    await hintsReady(page);

    // Already under the two larger limits: said so. WhatsApp: the planned size and resolution, up front.
    await expect(hint(page, 'share')).toHaveAttribute('data-state', 'already');
    await expect(hint(page, 'share')).toContainText('Videon zaten bunun altında');
    await expect(hint(page, 'email')).toHaveAttribute('data-state', 'already');
    // Smaller than the source either way: the bitrate lowered, or this browser's ordinary download already under 16 MB.
    await expect(hint(page, 'whatsapp')).toHaveAttribute('data-state', /^(reduced|normal)$/);
    await expect(hint(page, 'whatsapp')).toContainText(/^≈ \d+(,\d)? MB · (1080|720|540|360)p/);
    const planned = Number(await hint(page, 'whatsapp').getAttribute('data-planned-bytes'));
    expect(planned).toBeGreaterThan(1_000_000);
    expect(planned).toBeLessThanOrEqual(16_000_000);

    await page.getByTestId('option-whatsapp').check();
    await download(page);
    expect(await pickerCalls(page)).toEqual(['noisy-720p30-14s_kucuk.mp4']);
    const file = await readSaved(page, testInfo, 'saved-noisy-720p30-14s_kucuk.mp4');
    const savedBytes = fileBytes(file);
    const line = page.getByTestId('target-size-result');
    await expect(line).toHaveAttribute('data-target-bytes', '16000000');
    // What the app says is the file's own size, and "under the target" only when it is.
    expect(Number(await line.getAttribute('data-actual-bytes'))).toBe(savedBytes);
    expect((await line.getAttribute('data-fits')) === 'true').toBe(savedBytes <= 16_000_000);
    expect(savedBytes).toBeLessThanOrEqual(16_000_000);
    await expect(line).toContainText('hedefin altında (hedef 16 MB)');
    const probe = probeMp4(file);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    expect(probe.durationS).toBeCloseTo(14, 1);
    console.log(
      `Küçült → WhatsApp: source ${fileBytes(source)}, planned ${planned}, saved ${savedBytes}, ` +
        `${await line.getAttribute('data-short-edge')}p, attempts ${await line.getAttribute('data-attempts')}`,
    );
    // Nothing is stored by a wizard.
    await page.waitForTimeout(1200);
    expect(await storedProjects(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a video already under the limit: said before İndir, and its pictures are copied, not re-encoded', async ({
    page,
  }, testInfo) => {
    await startTask(page, 'kucult', SAMPLE);
    await expect(page.getByTestId('kucult-choice')).toBeVisible({ timeout: 60_000 });
    await hintsReady(page);
    for (const id of ['share', 'email', 'whatsapp']) {
      await expect(hint(page, id)).toHaveAttribute('data-state', 'already');
      await expect(hint(page, id)).toContainText('Videon zaten bunun altında (473 KB)');
    }
    await page.getByTestId('option-whatsapp').check();
    await download(page);
    const file = await readSaved(page, testInfo, 'saved-sample-24s_kucuk.mp4');
    expect(fileBytes(file)).toBeLessThanOrEqual(16_000_000);
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-method', 'copy');
    const line = page.getByTestId('target-size-result');
    await expect(line).toHaveAttribute('data-mode', 'copy');
    await expect(line).toContainText('hedefin altında');
    await expect(line).toContainText('yeniden kodlanmadı');
    expect([probeMp4(file).width, probeMp4(file).height]).toEqual([1280, 720]);
  });

  test('a video that cannot fit: the option says the smallest size, İndir stays off, nothing is written', async ({
    page,
  }) => {
    // 5 minutes at ~1 Mbit/s (~38 MB). With this browser's software encoder 16 MB is not reachable.
    await startTask(page, 'kucult', longNoisyFixture());
    await expect(page.getByTestId('kucult-choice')).toBeVisible({ timeout: 120_000 });
    await hintsReady(page);
    await expect(hint(page, 'whatsapp')).toHaveAttribute('data-state', 'refused');
    await expect(hint(page, 'whatsapp')).toContainText(/Bu video buna sığmaz: en az \d+(,\d)? MB gerekir\./);
    const minBytes = Number(await hint(page, 'whatsapp').getAttribute('data-min-bytes'));
    expect(minBytes).toBeGreaterThan(16_000_000);
    // The default (share, 52 MB) can be downloaded …
    await expect(page.getByTestId('wizard-download')).toBeEnabled();
    // … the one that cannot fit cannot: the reason is next to the button, and the button is off.
    await page.getByTestId('option-whatsapp').check();
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    await expect(page.getByTestId('wizard-blocked')).toContainText('Bu video bu boyuta sığmaz (hedef 16 MB). En az');
    await expect(page.getByTestId('wizard-blocked')).toContainText('uzunluğunda bir kesit seç');
    expect(await pickerCalls(page)).toEqual([]);
    expect(Object.keys(await opfsFiles(page)).filter((name) => name.startsWith('saved-'))).toEqual([]);
    // E-mail (25 MB) fits and can be chosen again.
    await page.getByTestId('option-email').check();
    await expect(page.getByTestId('wizard-download')).toBeEnabled();
    await expect(page.getByTestId('wizard-blocked')).toHaveCount(0);
  });
});

// ------------------------------------------------------------------ Sesini al (ADR-035)

test.describe('Sesini al', () => {
  test('no decision: İndir saves an M4A with no video track, exactly as long as the video', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startTask(page, 'ses', SAMPLE);
    await expect(page.getByTestId('ses-info')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText('Videonun sesini alalım');
    await expect(page.getByTestId('ses-info')).toContainText('ses dosyası (M4A)');
    await expect(page.getByRole('radio')).toHaveCount(0);

    await download(page);
    await expect(page.getByTestId('download-saved')).toHaveText('Ses dosyası kaydedildi: saved-sample-24s_ses.m4a');
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-output', 'audio');
    expect(await pickerCalls(page)).toEqual(['sample-24s_ses.m4a']);
    const file = await readSaved(page, testInfo, 'saved-sample-24s_ses.m4a');
    const probe = probeStreams(file);
    expect(probe.streams.map((stream) => `${stream.type}:${stream.codec}`)).toEqual(['audio:aac']);
    expect(Math.abs(probe.durationS - 24)).toBeLessThan(0.001);
    expect(decodeMono(file).length).toBe(24 * 48_000);
    await page.waitForTimeout(1200);
    expect(await storedProjects(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a video without sound: said on the step, İndir stays off, no save dialog, nothing written', async ({ page }) => {
    await startTask(page, 'ses', wizardFixture('noAudio'));
    await expect(page.getByTestId('ses-info')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('wizard-blocked')).toHaveText('Bu videoda ses yok; kaydedilecek bir ses dosyası çıkmaz.');
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    expect(await pickerCalls(page)).toEqual([]);
    expect(Object.keys(await opfsFiles(page)).filter((name) => name.startsWith('saved-'))).toEqual([]);
  });

  test('without a save dialog: “Ses dosyan hazır”, the download is an .m4a', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await noSavePicker(page);
    await startTask(page, 'ses', OTHER);
    await expect(page.getByTestId('ses-info')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('export-download')).toBeVisible({ timeout: 120_000 });
    await expect(title(page)).toHaveText('Ses dosyan hazır');
    await expect(page.getByTestId('export-download')).toHaveAttribute('download', 'other-8s_ses.m4a');
    await context.close();
  });
});

test.describe('wizard frame', () => {
  test('focus moves to the heading on every step; Geri walks back step by step', async ({ page }) => {
    await page.goto('/yap/cevir');
    await expect(title(page)).toHaveText('Videonu seç');
    // Not on arrival: the page starts at its top like any page.
    await expect(title(page)).not.toBeFocused();

    await page.getByTestId('video-input').setInputFiles(OTHER);
    await expect(wizard(page)).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
    await expect(title(page)).toBeFocused();
    await expect(page.getByTestId('wizard-step')).toContainText('Adım 2 / 3');

    await page.getByTestId('wizard-download').click();
    await expect(wizard(page)).toHaveAttribute('data-step', 'result');
    await expect(title(page)).toBeFocused();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
    await expect(title(page)).toHaveText('Kaydedildi');

    // Geri: result → choice → video → opening screen.
    await page.getByTestId('wizard-back').click();
    await expect(wizard(page)).toHaveAttribute('data-step', 'choose');
    await expect(title(page)).toBeFocused();
    await page.getByTestId('wizard-back').click();
    await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
    await expect(title(page)).toBeFocused();
    await page.getByTestId('wizard-back').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
  });

  test('after saving: “Paylaş”, “Başka bir video” and “Ana ekrana dön”', async ({ page }) => {
    await stubShare(page);
    await startTask(page, 'cevir', OTHER);
    await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
    await download(page);

    await page.getByTestId('download-share').click();
    await expect.poll(() => sharedFiles(page)).toHaveLength(1);
    const [shared] = await sharedFiles(page);
    expect(shared?.name).toBe('saved-other-8s_uyumlu.mp4');
    expect(shared?.type).toBe('video/mp4');
    expect(shared?.activation).toBe(true);

    await page.getByTestId('wizard-again').click();
    await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
    await page.getByTestId('video-input').setInputFiles(SAMPLE);
    await expect(page.getByTestId('wizard-video-name')).toHaveText('sample-24s.mp4', { timeout: 60_000 });
    await expect(wizard(page)).toHaveAttribute('data-step', 'choose');

    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
    await page.getByTestId('wizard-home').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ne yapmak istiyorsun?');
  });

  test('closing the save dialog does nothing and says nothing', async ({ page }) => {
    await startTask(page, 'cevir', OTHER);
    await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => {
      (window as unknown as { __pickerMode?: string }).__pickerMode = 'cancel';
    });
    await page.getByTestId('wizard-download').click();
    await page.waitForTimeout(500);
    await expect(wizard(page)).toHaveAttribute('data-step', 'choose');
    await expect(page.getByTestId('wizard-result')).toHaveCount(0);
    await expect(page.getByTestId('wizard-download')).toBeEnabled();
    // The next press works.
    await download(page);
  });

  test('without a save dialog (Safari, Firefox): the file waits for “Bilgisayara kaydet”', async ({ browser }) => {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await noSavePicker(page);
    await page.goto('/yap/cevir');
    await page.getByTestId('video-input').setInputFiles(OTHER);
    await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('export-download')).toBeVisible({ timeout: 120_000 });
    await expect(title(page)).toHaveText('Videon hazır');
    await expect(page.getByTestId('export-download')).toHaveAttribute('download', 'other-8s_uyumlu.mp4');
    await expect(page.getByTestId('export-download')).toHaveText('Bilgisayara kaydet');
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
    expect(file.suggestedFilename()).toBe('other-8s_uyumlu.mp4');
    const path = await file.path();
    expect(probeMp4(path).videoCodec).toBe('h264');
    await context.close();
  });

  test('a file that is not a video is refused on the first step, with the editor’s sentence', async ({ page }) => {
    await page.goto('/yap/dikey');
    await page.getByTestId('video-input').setInputFiles({
      name: 'notlar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('video değil'),
    });
    await expect(page.getByTestId('media-error')).toContainText('“notlar.txt” açılamadı');
    await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
    await page.getByTestId('media-error-dismiss').click();
    await expect(page.getByTestId('media-error')).toHaveCount(0);
    // The button still works afterwards.
    await page.getByTestId('video-input').setInputFiles(OTHER);
    await expect(wizard(page)).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  });

  test('desktop: a video dropped on the page opens', async ({ page }) => {
    await page.goto('/yap/cevir');
    await expect(page.getByTestId('pick-video')).toContainText('videoyu buraya sürükleyip bırak');
    const bytes = readFileSync(OTHER).toString('base64');
    const transfer = await page.evaluateHandle((base64) => {
      const binary = atob(base64);
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([data], 'suruklenen.mp4', { type: 'video/mp4' }));
      return dataTransfer;
    }, bytes);
    await page.dispatchEvent('[data-testid="pick-video"]', 'dragover', { dataTransfer: transfer });
    await expect(page.getByTestId('pick-video')).toContainText('Bırak, açalım');
    await page.dispatchEvent('[data-testid="pick-video"]', 'drop', { dataTransfer: transfer });
    await expect(page.getByTestId('wizard-video-name')).toHaveText('suruklenen.mp4', { timeout: 60_000 });
    await expect(wizard(page)).toHaveAttribute('data-step', 'choose');
  });

  test('leaving while the video is being prepared asks first; “İptal et” stops it and leaves no file', async ({ page }) => {
    await startTask(page, 'dikey', SAMPLE); // 24 s at 1080 × 1920: long enough to act while it runs
    await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('export-progress')).toBeVisible({ timeout: 60_000 });
    await expect(title(page)).toHaveText('Hazırlanıyor…');
    await expect(page.getByText('Bitene kadar bu sayfayı kapatma.')).toBeVisible();
    // No way to the editor or to another video while it runs.
    await expect(page.getByTestId('wizard-open-editor')).toHaveCount(0);
    await expect(page.getByTestId('wizard-change-video')).toHaveCount(0);

    // The wordmark would leave the page: the question is asked, "no" stays.
    const messages: string[] = [];
    page.once('dialog', (dialog) => {
      messages.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByTestId('home-link').click();
    expect(messages).toEqual(['Video hâlâ hazırlanıyor. Çıkarsan yarıda kalır. Yine de çıkılsın mı?']);
    await expect(page).toHaveURL(/\/yap\/dikey$/);
    await expect(page.getByTestId('download-running')).toBeVisible();

    await page.getByTestId('export-cancel').click();
    await expect(page.getByTestId('export-canceled')).toBeVisible({ timeout: 30_000 });
    await expect(title(page)).toHaveText('Durduruldu');
    await expect(page.getByTestId('download-saved')).toHaveCount(0);
    await page.getByTestId('wizard-back-to-choice').click();
    await expect(wizard(page)).toHaveAttribute('data-step', 'choose');
    await expect(page.getByTestId('option-cover')).toBeChecked();
  });

  test('phone: the same flow in one column, nothing scrolls sideways, big targets', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await installSavePicker(page);
    await page.goto('/');
    await page.getByTestId('task-dikey').tap();
    await expect(page.getByTestId('pick-video')).toContainText('Galeriden ya da dosyalardan');
    expect((await page.getByTestId('pick-video').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(200);
    await page.getByTestId('video-input').setInputFiles(OTHER);
    await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    for (const testId of ['wizard-back', 'wizard-change-video', 'wizard-download', 'wizard-open-editor', 'wizard-play']) {
      expect((await page.getByTestId(testId).boundingBox())?.height ?? 0, testId).toBeGreaterThanOrEqual(44);
    }
    for (const option of await page.locator('.wizard-option').all()) {
      expect((await option.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(60);
    }
    await page.locator('.wizard-option').nth(1).tap();
    await expect(page.getByTestId('option-contain')).toBeChecked();
    await page.getByTestId('wizard-download').tap();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
    expect(await overflow()).toBeLessThanOrEqual(1);
    for (const testId of ['wizard-again', 'wizard-home', 'download-dismiss']) {
      expect((await page.getByTestId(testId).boundingBox())?.height ?? 0, testId).toBeGreaterThanOrEqual(44);
    }
    await context.close();
  });
});
