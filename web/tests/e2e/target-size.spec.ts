import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  addKesit,
  closeSheet,
  installSavePicker,
  openEditor,
  openSettings,
  openVideo,
  opfsFiles,
  pickerCalls,
  readSaved,
} from './kesitFlow';
import { fileBytes, noisyFixture, probeStreams } from './targetsize-media';

/**
 * ADR-035, "Küçült": a download that must come out at or under a size.
 * Driven through the ordinary download button with the test hook
 * `window.__clipExportOptions` (the task screens pass the same options to
 * `useDownloads().start`). Every size is read from the saved file itself.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');

async function open(page: Page, file: string): Promise<string[]> {
  await installSavePicker(page);
  const errors = await openEditor(page);
  await openVideo(page, file);
  return errors;
}

async function setTarget(page: Page, targetBytes: number, minShortEdge?: number) {
  await page.evaluate(
    (options) => {
      (window as unknown as { __clipExportOptions?: unknown }).__clipExportOptions = options;
    },
    { targetSize: { targetBytes, ...(minShortEdge ? { minShortEdge } : {}) } },
  );
}

async function setFrame(page: Page, aspect: '16-9' | '9-16', quality: '720' | '1080') {
  await openSettings(page, 'frame');
  await page.getByTestId(`aspect-${aspect}`).click();
  await page.getByTestId('export-quality').selectOption(quality);
  await closeSheet(page);
}

interface TargetResult {
  fits: boolean;
  targetBytes: number;
  plannedBytes: number;
  actualBytes: number;
  attempts: number;
  shortEdge: number;
  mode: string;
  text: string;
  file: string;
  savedBytes: number;
}

/** Presses the download button and reads the finished target-size result and its file. */
async function downloadTarget(page: Page, testInfo: TestInfo): Promise<TargetResult> {
  await page.getByTestId('download-all').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 240_000 });
  const line = page.getByTestId('target-size-result');
  await expect(line).toBeVisible();
  const attr = async (name: string) => (await line.getAttribute(`data-${name}`)) ?? '';
  const name = (await pickerCalls(page)).at(-1) as string;
  const file = await readSaved(page, testInfo, `saved-${name}`);
  const result: TargetResult = {
    fits: (await attr('fits')) === 'true',
    targetBytes: Number(await attr('target-bytes')),
    plannedBytes: Number(await attr('planned-bytes')),
    actualBytes: Number(await attr('actual-bytes')),
    attempts: Number(await attr('attempts')),
    shortEdge: Number(await attr('short-edge')),
    mode: await attr('mode'),
    text: ((await line.textContent()) ?? '').trim(),
    file,
    savedBytes: fileBytes(file),
  };
  await page.getByTestId('download-dismiss').first().click();
  return result;
}

test.describe('target-size download (ADR-035)', () => {
  test.setTimeout(600_000);

  test('lands at or under the target for several lengths and targets', async ({ page }, testInfo) => {
    const errors = await open(page, SAMPLE);
    await setFrame(page, '16-9', '1080');
    const lines: string[] = [];
    // Length (s) and targets (bytes): from roomy to close to the floor.
    const cases: [string, string, number, number[]][] = [
      ['00:01.000', '00:05.000', 4, [2_000_000, 600_000]],
      ['00:02.000', '00:14.000', 12, [4_000_000, 1_500_000]],
      ['00:00.000', '00:24.000', 24, [16_000_000, 6_000_000, 2_500_000]],
    ];
    for (const [from, to, seconds, targets] of cases) {
      await addKesit(page, from, to);
      for (const targetBytes of targets) {
        await setTarget(page, targetBytes);
        const result = await downloadTarget(page, testInfo);
        lines.push(
          `${seconds} s, target ${targetBytes}: planned ${result.plannedBytes}, actual ${result.savedBytes}, ` +
            `${result.shortEdge}p, ${result.mode}, attempts ${result.attempts}`,
        );
        // The reported size is the file's size, and "fits" is said only when it does.
        expect(result.actualBytes).toBe(result.savedBytes);
        expect(result.targetBytes).toBe(targetBytes);
        expect(result.fits).toBe(result.savedBytes <= targetBytes);
        expect(result.savedBytes, lines.at(-1)).toBeLessThanOrEqual(targetBytes);
        expect(result.plannedBytes).toBeLessThanOrEqual(targetBytes);
        expect(result.text).toContain('hedefin altında');
        const probe = probeStreams(result.file);
        expect(Math.abs(probe.durationS - seconds)).toBeLessThan(0.05);
        expect(probe.streams.map((stream) => stream.type).sort()).toEqual(['audio', 'video']);
      }
      await page.getByTestId('kesit-delete').first().click();
    }
    testInfo.annotations.push({ type: 'target-size', description: lines.join(' | ') });
    console.log(lines.join('\n'));
    expect(errors).toEqual([]);
  });

  test('an impossible target is refused before the save dialog, with the smallest size that works', async ({
    page,
  }, testInfo) => {
    const errors = await open(page, SAMPLE);
    await setFrame(page, '16-9', '1080');
    await addKesit(page, '00:00.000', '00:24.000');
    await setTarget(page, 300_000);
    // The encoder kinds are asked in the background; the press refuses once they are known.
    await page.waitForTimeout(1500);
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('export-blocked')).toBeVisible({ timeout: 30_000 });
    const refusal = page.getByTestId('target-size-refusal');
    await expect(refusal).toBeVisible();
    await expect(page.getByTestId('export-blocked')).toContainText('Bu video bu boyuta sığmaz');
    await expect(refusal).toContainText('En az');
    // Refused before anything else happened: no save dialog, no file, no encode.
    expect(await pickerCalls(page)).toEqual([]);
    expect(Object.keys(await opfsFiles(page)).filter((name) => name.startsWith('saved-'))).toEqual([]);
    await expect(page.getByTestId('download-running')).toHaveCount(0);

    // The smallest size it names really works.
    const minBytes = Number(await refusal.getAttribute('data-min-bytes'));
    expect(minBytes).toBeGreaterThan(300_000);
    await page.getByTestId('download-dismiss').first().click();
    await setTarget(page, minBytes);
    const result = await downloadTarget(page, testInfo);
    expect(result.savedBytes).toBeLessThanOrEqual(minBytes);
    expect(result.shortEdge).toBe(360);
    expect(errors).toEqual([]);
  });

  test('a floor of 720p refuses instead of going below it', async ({ page }) => {
    await open(page, SAMPLE);
    await setFrame(page, '16-9', '1080');
    await addKesit(page, '00:00.000', '00:24.000');
    // Fits at 360p (see the test above), not at 720p.
    await setTarget(page, 2_500_000, 720);
    await page.waitForTimeout(1500);
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('target-size-refusal')).toBeVisible({ timeout: 30_000 });
    expect(await pickerCalls(page)).toEqual([]);
  });

  test('a source that already fits is copied, not re-encoded', async ({ page }, testInfo) => {
    const errors = await open(page, SAMPLE);
    // The frame is the source's own (16:9, 720p): the fast cut is allowed.
    await setFrame(page, '16-9', '720');
    await addKesit(page, '00:00.000', '00:24.000');
    await setTarget(page, 16_000_000);
    const result = await downloadTarget(page, testInfo);
    expect(result.mode).toBe('copy');
    expect(result.attempts).toBe(0);
    expect(result.savedBytes).toBeLessThanOrEqual(16_000_000);
    expect(result.text).toContain('yeniden kodlanmadı');
    expect(errors).toEqual([]);
  });

  test('a copy that would not fit is encoded to the target instead', async ({ page }, testInfo) => {
    const noisy = noisyFixture();
    const errors = await open(page, noisy);
    await setFrame(page, '16-9', '720');
    await addKesit(page, '00:00.000', '00:08.000');
    // The source is ~12 MB: over the target, so its pictures cannot be kept.
    expect(fileBytes(noisy)).toBeGreaterThan(6_000_000);
    await setTarget(page, 6_000_000);
    await page.getByTestId('download-all').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 300_000 });
    const line = page.getByTestId('target-size-result');
    const method = page.getByTestId('export-method');
    await expect(method).toHaveAttribute('data-method', 'encode');
    await expect(method).toHaveAttribute('data-fallback', 'target_size');
    const name = (await pickerCalls(page)).at(-1) as string;
    const saved = fileBytes(await readSaved(page, testInfo, `saved-${name}`));
    const fits = (await line.getAttribute('data-fits')) === 'true';
    const attempts = Number(await line.getAttribute('data-attempts'));
    console.log(`noisy 8 s, target 6000000: actual ${saved}, fits ${fits}, attempts ${attempts}, ${await line.getAttribute('data-short-edge')}p`);
    // Honest either way: "fits" exactly when the file is at or under the target.
    expect(Number(await line.getAttribute('data-actual-bytes'))).toBe(saved);
    expect(fits).toBe(saved <= 6_000_000);
    await expect(line).toContainText(fits ? 'hedefin altında' : 'hedefin üstünde');
    expect(errors).toEqual([]);
  });
});
