import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import {
  addKesit,
  closeSheet,
  installSavePicker,
  openEditor,
  openSettings,
  openVideo,
  pickerCalls,
  probeMp4,
  readSaved,
} from './kesitFlow';
import { clickFixture, decodeMono } from './targetsize-media';

/**
 * Music covers the download it is saved with.
 *
 * Found by the opening-screen work (ADR-034): with no kesit, adding music in
 * the editor selected 0.1 s of it (the shortest possible kesit), and "Videoyu
 * indir" then saved the whole video with a tenth of a second of music. The
 * saved file is measured here — its sound decoded by ffmpeg — not the recipe.
 *
 * The video's own sound is a 2 ms click on every whole second and silence in
 * between; the music is a steady 220 Hz tone. So the level between the
 * clicks, second by second, says exactly where the music plays.
 */

const MUSIC = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');
const RATE = 48_000;

/** RMS of the sound between the clicks of second `index` (0.2 s … 0.9 s into it). */
function levelInSecond(samples: Float32Array, index: number): number {
  const from = Math.round((index + 0.2) * RATE);
  const to = Math.min(samples.length, Math.round((index + 0.9) * RATE));
  let energy = 0;
  for (let i = from; i < to; i += 1) energy += (samples[i] ?? 0) ** 2;
  return to > from ? Math.sqrt(energy / (to - from)) : 0;
}

/** Which whole seconds of the file carry the music's tone. */
function secondsWithMusic(file: string, seconds: number): boolean[] {
  const samples = decodeMono(file);
  return Array.from({ length: seconds }, (_, index) => levelInSecond(samples, index) > 0.01);
}

async function addMusic(page: Page) {
  await page.getByTestId('audio-input').setInputFiles(MUSIC);
  await openSettings(page, 'audio');
  await expect(page.getByTestId('music-in')).toBeVisible({ timeout: 30_000 });
}

async function downloadAll(page: Page, testInfo: Parameters<typeof readSaved>[1]): Promise<string> {
  const before = (await pickerCalls(page)).length;
  await page.getByTestId('download-all').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 180_000 });
  const name = (await pickerCalls(page))[before] as string;
  return readSaved(page, testInfo, `saved-${name}`);
}

test.describe('music covers the download', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(300_000);

  test('no kesit: music added in the editor plays under the whole downloaded video, not 0.1 s of it', async ({
    page,
  }, testInfo) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, clickFixture());
    await expect(page.getByTestId('kesit-card')).toHaveCount(0);

    await addMusic(page);
    // What the editor says it selected: the video's 12 s (the music is 30 s long).
    await expect(page.getByTestId('music-in')).toHaveValue('00:00.000');
    await expect(page.getByTestId('music-out')).toHaveValue('00:12.000');
    await closeSheet(page);

    await expect(page.getByTestId('download-all')).toHaveText('Videoyu indir');
    const file = await downloadAll(page, testInfo);
    const probe = probeMp4(file);
    expect(probe.durationS).toBeCloseTo(12, 1);
    expect(probe.audioCodec).toBe('aac');
    // The tone is there in every one of the twelve seconds.
    expect(secondsWithMusic(file, 12)).toEqual(Array.from({ length: 12 }, () => true));
    expect(errors).toEqual([]);
  });

  test('kesitler change: the music follows the joined length, one undo step takes both back', async ({
    page,
  }, testInfo) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, clickFixture());
    await addMusic(page);
    await expect(page.getByTestId('music-out')).toHaveValue('00:12.000');
    await closeSheet(page);

    // The first kesit: the download is now 3 s long, and so is the music.
    await addKesit(page, '00:02.000', '00:05.000');
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-out')).toHaveValue('00:03.000');
    await closeSheet(page);

    // A second kesit: 3 + 4 = 7 s.
    await addKesit(page, '00:06.000', '00:10.000');
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-out')).toHaveValue('00:07.000');
    await closeSheet(page);

    const file = await downloadAll(page, testInfo);
    expect(probeMp4(file).durationS).toBeCloseTo(7, 1);
    expect(secondsWithMusic(file, 7)).toEqual(Array.from({ length: 7 }, () => true));

    // One undo: the second kesit is gone and the music is 3 s again — one step, not two.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-out')).toHaveValue('00:03.000');
    await closeSheet(page);
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('kesit-card')).toHaveCount(0);
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-out')).toHaveValue('00:12.000');
    await closeSheet(page);
    expect(errors).toEqual([]);
  });

  test('a music range the user set by hand is left alone when kesitler change', async ({ page }, testInfo) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, clickFixture());
    await addKesit(page, '00:00.000', '00:06.000');
    await addMusic(page);
    await expect(page.getByTestId('music-out')).toHaveValue('00:06.000');
    // "Only the first two seconds of music."
    await page.getByTestId('music-out').fill('00:02.000');
    await page.getByTestId('music-out').blur();
    await expect(page.getByTestId('music-out')).toHaveValue('00:02.000');
    await closeSheet(page);

    await addKesit(page, '00:07.000', '00:10.000');
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-out')).toHaveValue('00:02.000');
    await closeSheet(page);

    const file = await downloadAll(page, testInfo);
    expect(probeMp4(file).durationS).toBeCloseTo(9, 1);
    expect(secondsWithMusic(file, 9)).toEqual([true, true, false, false, false, false, false, false, false]);
    expect(errors).toEqual([]);
  });
});
