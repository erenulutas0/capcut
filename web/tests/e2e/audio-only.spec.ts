import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import {
  addKesit,
  closeSheet,
  installSavePicker,
  noSavePicker,
  openEditor,
  openSettings,
  openVideo,
  opfsFiles,
  pickerCalls,
  readSaved,
  sharedFiles,
} from './kesitFlow';
import { clickFixture, clickPositions, decodeMono, probeStreams, silentFixture } from './targetsize-media';

/**
 * ADR-035, "Sesini al": the selected ranges' sound as an M4A file (AAC in
 * MP4, no video track). Driven through the ordinary download button with the
 * test hook `window.__clipExportOptions = { output: 'audio' }`. The saved
 * file is checked with ffprobe/ffmpeg, which know nothing about our muxer.
 */

const RATE = 48_000;

async function audioHook(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __clipExportOptions?: unknown }).__clipExportOptions = { output: 'audio' };
  });
}

test.describe('sound-only download (ADR-035)', () => {
  test.setTimeout(300_000);

  test('one kesit: a valid M4A with no video track, the exact length, the sound where it belongs', async ({
    page,
  }, testInfo) => {
    await audioHook(page);
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, clickFixture());
    // Clicks sit on every whole second of the source: 3, 4, … 9 s fall inside.
    await addKesit(page, '00:02.500', '00:09.250');
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('download-saved')).toContainText('Ses dosyası kaydedildi');
    await expect(page.getByTestId('export-method')).toHaveAttribute('data-output', 'audio');
    await expect(page.getByTestId('measured-resolution')).toHaveCount(0);

    const name = (await pickerCalls(page)).at(-1) as string;
    expect(name.endsWith('.m4a')).toBe(true);
    const file = await readSaved(page, testInfo, `saved-${name}`);

    const probe = probeStreams(file);
    expect(probe.streams.map((stream) => `${stream.type}:${stream.codec}`)).toEqual(['audio:aac']);
    expect(probe.streams[0]?.sampleRate).toBe(RATE);
    // 6.75 s exactly: the container says so to the sample, and so does the decoded sound.
    expect(Math.abs(probe.durationS - 6.75)).toBeLessThan(0.001);
    const samples = decodeMono(file);
    expect(Math.abs(samples.length - 6.75 * RATE)).toBeLessThanOrEqual(2);

    // Source clicks at 3..9 s are at 0.5, 1.5 … 6.5 s of the kesit, within 1 ms.
    const clicks = clickPositions(samples).map((position) => position / RATE);
    console.log(`clicks at ${clicks.map((value) => value.toFixed(4)).join(', ')} s; ${samples.length} samples`);
    expect(clicks.length).toBe(7);
    clicks.forEach((at, index) => expect(Math.abs(at - (0.5 + index))).toBeLessThan(0.001));
    expect(errors).toEqual([]);
  });

  test('two kesitler are joined; the fallback route offers an .m4a download of type audio/mp4', async ({
    page,
  }, testInfo) => {
    await audioHook(page);
    await noSavePicker(page);
    // A share sheet that takes any file and records what it was given (name, MIME type).
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: unknown[] };
      w.__shared = [];
      Object.defineProperty(Navigator.prototype, 'canShare', {
        configurable: true,
        value: (data?: { files?: File[] }) => Boolean(data?.files?.length),
      });
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (data?: { files?: File[] }) => {
          for (const file of data?.files ?? []) w.__shared.push({ name: file.name, type: file.type, size: file.size, activation: true });
        },
      });
    });
    const errors = await openEditor(page);
    await openVideo(page, clickFixture());
    await addKesit(page, '00:00.500', '00:02.500');
    await addKesit(page, '00:06.250', '00:09.750');
    await page.getByTestId('download-all').click();
    const link = page.getByTestId('export-download');
    await expect(link).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('download-ready-title')).toContainText('Ses dosyası hazır');
    const downloadName = (await link.getAttribute('download')) ?? '';
    expect(downloadName.endsWith('.m4a')).toBe(true);
    // The file handed to the share sheet is the M4A, typed audio/mp4.
    await page.getByTestId('download-share').click();
    await expect.poll(async () => (await sharedFiles(page)).length).toBe(1);
    const shared = (await sharedFiles(page))[0];
    expect(shared?.type).toBe('audio/mp4');
    expect(shared?.name).toBe(downloadName);

    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    const probe = probeStreams(file);
    expect(probe.streams.map((stream) => `${stream.type}:${stream.codec}`)).toEqual(['audio:aac']);
    expect(Math.abs(probe.durationS - 5.5)).toBeLessThan(0.001);
    // Kesit 1 holds the clicks of 1 and 2 s (at 0.5, 1.5); kesit 2 those of 7, 8, 9 s (at 2.75, 3.75, 4.75).
    const clicks = clickPositions(decodeMono(file)).map((position) => position / RATE);
    expect(clicks.length).toBe(5);
    [0.5, 1.5, 2.75, 3.75, 4.75].forEach((at, index) => expect(Math.abs((clicks[index] ?? 0) - at)).toBeLessThan(0.001));
    expect(errors).toEqual([]);
  });

  test('a video without sound is refused before the save dialog and nothing is written', async ({ page }) => {
    await audioHook(page);
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, silentFixture());
    await addKesit(page, '00:01.000', '00:04.000');
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('export-blocked')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('export-blocked')).toContainText('kaydedilecek ses yok');
    expect(await pickerCalls(page)).toEqual([]);
    expect(Object.keys(await opfsFiles(page)).filter((name) => name.startsWith('saved-'))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a muted kesit with music gives the music alone; muted without music is refused', async ({
    page,
  }, testInfo) => {
    await audioHook(page);
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, clickFixture());
    await addKesit(page, '00:01.000', '00:05.000');
    await openSettings(page, 'audio');
    await page.getByTestId('clip-mute').click();
    await closeSheet(page);

    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('export-blocked')).toBeVisible({ timeout: 30_000 });
    expect(await pickerCalls(page)).toEqual([]);
    await page.getByTestId('download-dismiss').first().click();

    await page.getByTestId('audio-input').setInputFiles(join(process.cwd(), 'tests', 'media', 'tone-30s.m4a'));
    await openSettings(page, 'audio');
    await expect(page.getByTestId('music-in')).toBeVisible({ timeout: 30_000 });
    await closeSheet(page);
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
    const name = (await pickerCalls(page)).at(-1) as string;
    const file = await readSaved(page, testInfo, `saved-${name}`);
    const probe = probeStreams(file);
    expect(probe.streams.map((stream) => `${stream.type}:${stream.codec}`)).toEqual(['audio:aac']);
    expect(Math.abs(probe.durationS - 4)).toBeLessThan(0.001);
    // The source's clicks are muted; the music's steady tone is there.
    const samples = decodeMono(file);
    let energy = 0;
    for (const value of samples) energy += value * value;
    expect(Math.sqrt(energy / samples.length)).toBeGreaterThan(0.01);
    expect(errors).toEqual([]);
  });
});
