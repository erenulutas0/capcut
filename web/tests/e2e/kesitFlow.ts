/**
 * Shared steps for the kesit editor (ADR-026): open a video, mark and add
 * kesitler, open Ayarlar / Diğer, and download through a stand-in for the
 * browser's save dialog.
 *
 * The real `showSaveFilePicker` opens an operating-system dialog a test
 * cannot drive. `installSavePicker` replaces it, before the page loads, with one
 * that returns a file in the page's own private storage (OPFS). That handle
 * has the same `createWritable()` the real one has, and it travels to the
 * export worker the same way, so the app's code path is the real one; only
 * the place on disk differs. `noSavePicker` removes the API, like Firefox or
 * Safari, to drive the fallback route ("Bilgisayara kaydet").
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';

export async function openEditor(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('download-all')).toBeVisible();
  return errors;
}

export async function openVideo(page: Page, file: string | Parameters<Page['setInputFiles']>[1]) {
  await page.getByTestId('video-input').setInputFiles(file as string);
  await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
}

/** Types Başlangıç and Bitiş and presses "Kesit ekle". */
export async function addKesit(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

export function kesitRanges(page: Page) {
  return page.getByTestId('kesit-range');
}

/** Opens Ayarlar on a tab ('frame' | 'audio' | 'captions'). */
export async function openSettings(page: Page, tab: 'frame' | 'audio' | 'captions' = 'frame') {
  await page.getByTestId('open-settings').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId(`inspector-tab-${tab}`).click();
}

export async function closeSheet(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function openMore(page: Page) {
  await page.getByTestId('open-more').click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Seconds from "01:02.500" or "1:02:03.000". */
export function seconds(timecode: string): number {
  const [clock = '0', ms = '0'] = timecode.trim().split('.');
  let total = 0;
  for (const part of clock.split(':').map(Number)) total = total * 60 + part;
  return total + Number(`0.${ms}`);
}

export async function sourceMs(page: Page): Promise<number> {
  return Number(await page.getByTestId('source-time-us').textContent());
}

/** Moves the playhead with the keyboard: Home, then whole seconds. */
export async function playheadTo(page: Page, atS: number) {
  const playhead = page.getByTestId('timeline-playhead');
  await playhead.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < atS; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => sourceMs(page)).toBe(atS * 1000);
}

// ------------------------------------------------------------ save dialog

/**
 * Replaces the save dialog with one that writes into OPFS as
 * `saved-<suggested name>`. `window.__pickerMode = 'cancel'` makes the next
 * call behave like the user closing the dialog (AbortError).
 */
export async function installSavePicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      showSaveFilePicker: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
      __pickerCalls: string[];
      __pickerMode?: 'cancel';
    };
    w.__pickerCalls = [];
    w.showSaveFilePicker = async (options) => {
      w.__pickerCalls.push(options.suggestedName);
      if (w.__pickerMode === 'cancel') {
        w.__pickerMode = undefined;
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle(`saved-${options.suggestedName}`, { create: true });
    };
  });
}

/** No save dialog at all (Firefox, Safari): the fallback route. */
export async function noSavePicker(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (Window.prototype as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
}

export async function pickerCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __pickerCalls?: string[] }).__pickerCalls ?? []);
}

/** Files in the page's private storage, with their sizes. */
export async function opfsFiles(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const out: Record<string, number> = {};
    for await (const [name, handle] of (root as unknown as {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    }).entries()) {
      if (handle.kind === 'file') out[name] = (await (handle as FileSystemFileHandle).getFile()).size;
    }
    return out;
  });
}

/** Copies a saved file out of the page's storage into the test's output folder. */
export async function readSaved(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  const base64 = await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(fileName)).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  }, name);
  const path = testInfo.outputPath(name);
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return path;
}

export interface ProbedMp4 {
  durationS: number;
  frames: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

/** Measured by ffprobe, a tool that knows nothing about our encoder. */
export function probeMp4(file: string): ProbedMp4 {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-count_frames', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  const json = JSON.parse(result.stdout) as {
    format: { duration: string };
    streams: Array<{ codec_type: string; codec_name: string; nb_read_frames?: string; width?: number; height?: number }>;
  };
  const video = json.streams.find((stream) => stream.codec_type === 'video');
  const audio = json.streams.find((stream) => stream.codec_type === 'audio');
  return {
    durationS: Number(json.format.duration),
    frames: Number(video?.nb_read_frames ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

/** One frame, tiny and grey, to tell pictures apart (64×36 luma). */
export function frameGray(file: string, atS: number): Buffer {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-ss', atS.toFixed(3), '-i', file,
      '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', 'pipe:1',
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return result.stdout as unknown as Buffer;
}

export function meanAbsDiff(a: Buffer, b: Buffer): number {
  if (a.length === 0 || a.length !== b.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}

/** Which source second a frame of an export shows: the closest of `candidatesS`. */
export function closestSourceSecond(exported: string, atS: number, source: string, candidatesS: number[]): number {
  const frame = frameGray(exported, atS);
  let best = candidatesS[0] ?? 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of candidatesS) {
    const diff = meanAbsDiff(frame, frameGray(source, candidate));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

export async function clearStorage(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('clip-editor');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}
