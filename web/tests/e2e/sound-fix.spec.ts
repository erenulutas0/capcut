import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

import { installSavePicker, pickerCalls, readSaved } from './kesitFlow';
import {
  decodedFrameHashes,
  durations,
  firstVideoPacket,
  loudness,
  nalTypes,
  soundFixFixture,
  videoPacketHashes,
  type SoundFixFixture,
} from './soundfix-media';
import { probeStreams } from './targetsize-media';
import { wizardFixture } from './wizard-media';
import { fault, faultBeforeLoad, nextFault } from './workerFaultKit';

/**
 * "Sesi düzelt" (ADR-049) from the opening screen to the saved file, on
 * generated sources: the sound is measured on the device, the screen says
 * what will happen in plain words, and the saved file is measured with
 * ffmpeg — a meter that knows nothing about ours:
 *
 * - integrated loudness within ±1 LU of −16 LUFS, true peak at or under −1 dBTP;
 * - the video packets byte for byte the source's (the fast cut's copy, ADR-027);
 * - the length unchanged, the sound in sync with the picture (the sync clip of
 *   scripts/lib/av-sync.mjs).
 */

test.describe.configure({ timeout: 300_000 });

const TARGET = -16;
const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'); // 1280×720, H.264 + AAC, 24 s
const SYNC = join(process.cwd(), 'tests', 'media', 'soundfix', 'sync-clip.mp4');

const wizard = (page: Page) => page.getByTestId('wizard');

test.beforeEach(async ({ page }) => {
  await installSavePicker(page);
});

async function startTask(page: Page, file: string, path = '/') {
  await page.goto(path);
  await page.getByTestId('task-duzelt').click();
  await expect(wizard(page)).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file);
}

async function download(page: Page) {
  await page.getByTestId('wizard-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
}

/** The A/V measurement of scripts/lib/av-sync.mjs (typed here: its .d.mts lists only what the unit tests use). */
interface AvSyncModule {
  writeSyncClip(path: string, options?: { fps?: number }): string;
  avSync(file: string): { flashes: number; onsets: number; paired: number; medianMs: number | null; minMs: number | null; maxMs: number | null };
}
async function avSyncModule(): Promise<AvSyncModule> {
  return (await import('../../scripts/lib/av-sync.mjs')) as unknown as AvSyncModule;
}

/**
 * The copy path (ADR-027) keeps the source's compressed pictures: every video
 * packet byte for byte the source's — except that the first key frame also
 * carries the source's own parameter sets (SPS, PPS) in front of it, as every
 * fast-cut copy writes it — and so every decoded picture the same pixels.
 */
function samePictures(saved: string, source: string): void {
  const out = videoPacketHashes(saved);
  const original = videoPacketHashes(source);
  expect(out.length).toBe(original.length);
  expect(out.slice(1)).toEqual(original.slice(1));
  const first = firstVideoPacket(saved);
  const sourceFirst = firstVideoPacket(source);
  expect(first.subarray(first.length - sourceFirst.length).equals(sourceFirst)).toBe(true);
  expect(nalTypes(first).slice(0, 2)).toEqual([7, 8]);
  expect(decodedFrameHashes(saved)).toEqual(decodedFrameHashes(source));
}

/** Downloads with the fix and measures the saved file against its source. */
async function fixAndMeasure(page: Page, testInfo: Parameters<Parameters<typeof test>[1]>[1], source: string, savedName: string) {
  await download(page);
  const saved = await readSaved(page, testInfo, savedName);
  const measured = loudness(saved);
  const lengths = durations(saved);
  const sourceLengths = durations(source);
  // What was measured stays beside the saved file (test-results/), for the report of ADR-049.
  const body = JSON.stringify({ source: loudness(source), saved: measured, lengths, sourceLengths }, null, 1);
  writeFileSync(testInfo.outputPath('measured.json'), body);
  await testInfo.attach('measured', { body, contentType: 'application/json' });
  return { saved, measured, lengths, sourceLengths };
}

const CASES: ReadonlyArray<{ fixture: SoundFixFixture; file: string; change: string; uneven: boolean }> = [
  { fixture: 'quiet', file: 'kisik-konusma', change: 'Ses: çok kısık → normal', uneven: false },
  { fixture: 'uneven', file: 'dengesiz-konusma', change: 'Ses: kısık → normal', uneven: true },
  { fixture: 'loud', file: 'yuksek-muzik', change: 'Ses: çok yüksek → normal', uneven: false },
  { fixture: 'clipped', file: 'patlamis-konusma', change: 'Ses: çok yüksek → normal', uneven: false },
];

test.describe('Sesi düzelt', () => {
  for (const item of CASES) {
    test(`${item.fixture}: the screen says it plainly, and the file is at −16 LUFS, under −1 dBTP, with the source's own pictures`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const source = soundFixFixture(item.fixture);
      await startTask(page, source);
      await expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId('wizard-title')).toHaveText('Sesini düzeltelim');
      await expect(page.getByTestId('wizard-step')).toContainText('Adım 2 / 3');
      await expect(page.getByTestId('duzelt-change')).toHaveText(item.change);
      // The export's own checks say the pictures will be copied: only then is that promised.
      await expect(page.getByTestId('duzelt-body')).toHaveText('Sesin daha duyulur ve eşit olur; görüntüye dokunulmaz.');
      await expect(page.getByTestId('duzelt-keeps')).toContainText('Gürültüyü silmez');
      await expect(page.getByTestId('duzelt-uneven')).toHaveCount(item.uneven ? 1 : 0);
      // No choice to make, and no "editor" to continue in (the editor does not know this chain).
      await expect(page.getByRole('radio')).toHaveCount(0);
      await expect(page.getByTestId('wizard-open-editor')).toHaveCount(0);
      // The page's own measurement, before anything is encoded, agrees with ffmpeg's on the source.
      const before = Number(await page.getByTestId('duzelt-summary').getAttribute('data-before-lufs'));
      expect(Math.abs(before - loudness(source).integratedLufs)).toBeLessThanOrEqual(0.5);

      const { saved, measured, lengths, sourceLengths } = await fixAndMeasure(page, testInfo, source, `saved-${item.file}_ses-duzeltildi.mp4`);
      expect(await pickerCalls(page)).toEqual([`${item.file}_ses-duzeltildi.mp4`]);
      expect(Math.abs(measured.integratedLufs - TARGET), JSON.stringify(measured)).toBeLessThanOrEqual(1);
      expect(measured.truePeakDbtp, JSON.stringify(measured)).toBeLessThanOrEqual(-1);
      if (item.uneven) expect(measured.lraLu).toBeLessThan(loudness(source).lraLu - 8);
      // The picture: the source's own packets (see `samePictures`).
      samePictures(saved, source);
      await expect(page.getByTestId('export-method')).toHaveAttribute('data-method', 'copy');
      await expect(page.getByTestId('export-method')).toHaveText('Görüntüye dokunulmadı; kalitesi videondakiyle aynı');
      await expect(page.getByTestId('export-sound-fix')).toHaveText('Ses düzeltildi: daha duyulur ve eşit.');
      // As long as before: the picture to the frame, the sound with it.
      const frame = 1 / 30;
      expect(Math.abs((lengths.video ?? 0) - (sourceLengths.video ?? 0))).toBeLessThanOrEqual(frame + 0.001);
      expect(Math.abs((lengths.audio ?? 0) - (lengths.video ?? 0))).toBeLessThanOrEqual(frame + 0.001);
      expect(probeStreams(saved).streams.map((stream) => `${stream.type}:${stream.codec}`)).toEqual(['video:h264', 'audio:aac']);
      expect(errors).toEqual([]);
    });
  }

  test('the sound stays in sync with the picture (the sync clip)', async ({ page }, testInfo) => {
    const av = await avSyncModule();
    if (!existsSync(SYNC)) {
      mkdirSync(join(process.cwd(), 'tests', 'media', 'soundfix'), { recursive: true });
      av.writeSyncClip(SYNC);
    }
    await startTask(page, SYNC);
    await expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 120_000 });
    const { saved, measured } = await fixAndMeasure(page, testInfo, SYNC, 'saved-sync-clip_ses-duzeltildi.mp4');
    const source = av.avSync(SYNC);
    const fixed = av.avSync(saved);
    writeFileSync(testInfo.outputPath('sync.json'), JSON.stringify({ source, fixed, measured }, null, 1));
    expect(fixed.paired).toBe(source.paired);
    expect(fixed.paired).toBeGreaterThan(10);
    expect(Math.abs((fixed.medianMs ?? 99) - (source.medianMs ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(fixed.maxMs ?? 99)).toBeLessThanOrEqual(Math.abs(source.maxMs ?? 0) + 1);
    expect(measured.truePeakDbtp).toBeLessThanOrEqual(-1);
    samePictures(saved, SYNC);
  });

  test('a sound already at a good level is said to be good, and can still be downloaded', async ({ page }, testInfo) => {
    const source = soundFixFixture('good');
    await startTask(page, source);
    await expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('duzelt-already')).toHaveText('Sesin zaten iyi. Yine de indirebilirsin; pek bir şey değişmez.');
    await expect(page.getByTestId('duzelt-change')).toHaveCount(0);
    await expect(page.getByTestId('wizard-download')).toBeEnabled();
    const { measured } = await fixAndMeasure(page, testInfo, source, 'saved-iyi-konusma_ses-duzeltildi.mp4');
    expect(Math.abs(measured.integratedLufs - TARGET)).toBeLessThanOrEqual(1);
    expect(measured.truePeakDbtp).toBeLessThanOrEqual(-1);
  });

  test('five seconds before and after: one plays at a time, pressing it again stops it', async ({ page }) => {
    await startTask(page, soundFixFixture('quiet'));
    await expect(page.getByTestId('duzelt-listen')).toBeVisible({ timeout: 120_000 });
    const before = page.getByTestId('duzelt-listen-before');
    const after = page.getByTestId('duzelt-listen-after');
    await expect(before).toHaveText('Önce');
    await expect(after).toHaveText('Sonra');
    await after.click();
    await expect(after).toHaveAttribute('aria-pressed', 'true');
    await before.click();
    await expect(before).toHaveAttribute('aria-pressed', 'true');
    await expect(after).toHaveAttribute('aria-pressed', 'false');
    await before.click();
    await expect(before).toHaveAttribute('aria-pressed', 'false');
  });

  test('a sound track of silence: said, and nothing is offered for download', async ({ page }) => {
    await startTask(page, soundFixFixture('silence'));
    await expect(page.getByTestId('wizard-blocked')).toHaveText('Bu videonun sesinde duyulacak bir şey yok; açılacak bir ses bulunamadı.', {
      timeout: 120_000,
    });
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    await expect(page.getByTestId('duzelt-summary')).toHaveCount(0);
    expect(await pickerCalls(page)).toEqual([]);
  });

  test('a video with no sound: refused on the step, no measuring, no save dialog', async ({ page }) => {
    await startTask(page, wizardFixture('noAudio'));
    await expect(page.getByTestId('wizard-blocked')).toHaveText('Bu videoda ses yok; düzeltilecek bir ses yok.', { timeout: 60_000 });
    await expect(page.getByTestId('wizard-download')).toBeDisabled();
    await expect(page.getByTestId('duzelt-listening')).toHaveCount(0);
    await page.getByTestId('wizard-download').click({ force: true });
    expect(await pickerCalls(page)).toEqual([]);
  });

  test('a video whose pictures cannot be copied says so before the download, and says it after', async ({ page }, testInfo) => {
    await startTask(page, wizardFixture('webm'));
    await expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('duzelt-body')).toHaveText(
      'Sesin daha duyulur ve eşit olur. Görüntü de yeniden işlenir: bu video olduğu gibi kopyalanamıyor.',
    );
    const { measured } = await fixAndMeasure(page, testInfo, wizardFixture('webm'), 'saved-tarayici-kaydi_ses-duzeltildi.mp4');
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-method', 'encode');
    expect(Math.abs(measured.integratedLufs - TARGET)).toBeLessThanOrEqual(1);
    expect(measured.truePeakDbtp).toBeLessThanOrEqual(-1);
  });

  test('“Vazgeç” stops the measuring at once; trying again finishes it', async ({ page }) => {
    // The measuring is held still on purpose (test builds only), so the press comes while it runs.
    await faultBeforeLoad(page, fault('silence', 'stall'), 600_000);
    await startTask(page, SAMPLE);
    await expect(page.getByTestId('duzelt-stop')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('duzelt-listening').getByRole('progressbar')).toBeVisible();
    await expect(page.getByTestId('wizard-download')).toHaveCount(0);
    await page.getByTestId('duzelt-stop').click();
    const problem = page.getByTestId('duzelt-problem');
    await expect(problem).toHaveAttribute('data-status', 'canceled', { timeout: 10_000 });
    await expect(problem.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('duzelt-failed-details')).toHaveCount(0);
    await nextFault(page, null, 1000);
    await page.getByTestId('duzelt-retry').click();
    await expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('wizard-download')).toBeEnabled();
  });

});

test.describe('Sesi düzelt in English', () => {
  test.use({ locale: 'en-US', storageState: { cookies: [], origins: [] } });

  test('an English browser gets the English card and screen', async ({ page }) => {
    await startTask(page, soundFixFixture('quiet'), '/en/');
    await expect(page).toHaveURL(/\/en\/yap\/duzelt\/?$/);
    await expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('wizard-title')).toHaveText('Let’s fix your sound');
    await expect(page.getByTestId('duzelt-change')).toHaveText('Sound: very quiet → normal');
    await expect(page.getByTestId('duzelt-body')).toHaveText('Your sound becomes easier to hear and more even; the picture is not touched.');
    await expect(page.getByTestId('duzelt-keeps')).toContainText('It does not remove noise');
  });
});
