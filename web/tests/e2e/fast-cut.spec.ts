import { expect, test, type Page } from '@playwright/test';

import { barcodeFrames, fastCutFixture, frameMd5s, probeFrames } from './fastcut-media';
import { startWithEmptyTimeline } from './rangeFlow';

/**
 * ADR-027: a download whose frames need no change keeps the source's own
 * compressed pictures; only the frames between a cut and the next IDR are
 * re-encoded. Checked with ffmpeg on the saved file: every frame is exactly
 * the marked source frame (burned-in barcode), and every frame that was not
 * re-encoded is bit-for-bit the source's decoded frame.
 */

async function openFixture(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await page.getByTestId('video-input').setInputFiles(fastCutFixture());
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await startWithEmptyTimeline(page);
  return errors;
}

async function addMoment(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

async function exportAt720(page: Page) {
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-quality').selectOption('720');
  await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
  await page.getByTestId('export-create').click();
  await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
}

async function savedFile(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  return (await download).path();
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

test.describe('fast cut', () => {
  test('two moments cut off the keyframes: smart cut, every frame exact, copied frames bit-exact', async ({ page }) => {
    const errors = await openFixture(page);
    // Frames 33..119 and 165..266 (IDR every 30 frames, B-frames).
    await addMoment(page, '00:01.100', '00:04.000');
    await addMoment(page, '00:05.500', '00:08.900');
    await exportAt720(page);

    const method = page.getByTestId('measured-method');
    await expect(method).toHaveAttribute('data-method', 'smart');
    await expect(method).toContainText('Hızlı kesim');
    const encoded = Number(await method.getAttribute('data-frames-encoded'));
    // The heads up to the next IDR (27 + 15) and at most a B-frame group at the end.
    expect(encoded).toBeGreaterThanOrEqual(42);
    expect(encoded).toBeLessThanOrEqual(42 + 8);

    const file = await savedFile(page);
    const expected = [...range(33, 119), ...range(165, 266)];
    const probe = probeFrames(file);
    expect(probe.frames).toBe(expected.length);
    expect(Math.abs(probe.durationS - expected.length / 30)).toBeLessThanOrEqual(1 / 30 + 0.002);
    expect(barcodeFrames(file)).toEqual(expected);

    const source = frameMd5s(fastCutFixture());
    const output = frameMd5s(file);
    const identical = output.filter((md5, i) => md5 === source[expected[i] ?? -1]).length;
    expect(identical).toBe(expected.length - encoded);
    expect(errors).toEqual([]);
  });

  test('a moment from one IDR to the next is a pure copy', async ({ page }) => {
    const errors = await openFixture(page);
    await addMoment(page, '00:02.000', '00:04.000');
    await exportAt720(page);

    const method = page.getByTestId('measured-method');
    await expect(method).toHaveAttribute('data-method', 'copy');
    await expect(method).toHaveText('Hızlı kesim — görüntü yeniden kodlanmadı');

    const file = await savedFile(page);
    const expected = range(60, 119);
    expect(barcodeFrames(file)).toEqual(expected);
    const source = frameMd5s(fastCutFixture());
    expect(frameMd5s(file)).toEqual(expected.map((n) => source[n]));
    expect(errors).toEqual([]);
  });

  test('a zoomed picture is encoded and the dialog says why', async ({ page }) => {
    const errors = await openFixture(page);
    await addMoment(page, '00:01.000', '00:03.000');
    await page.getByTestId('zoom-slider').fill('1.5');
    await exportAt720(page);

    const method = page.getByTestId('measured-method');
    await expect(method).toHaveAttribute('data-method', 'encode');
    await expect(method).toHaveAttribute('data-fallback', 'crop');
    await expect(method).toHaveText('Kodlandı (kırpma veya yakınlaştırma var)');
    expect(errors).toEqual([]);
  });

  test('a different download size is encoded (1080p from a 720p source)', async ({ page }) => {
    const errors = await openFixture(page);
    await addMoment(page, '00:01.000', '00:02.000');
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-quality').selectOption('1080');
    await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
    await page.getByTestId('export-create').click();
    await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
    await expect(page.getByTestId('measured-method')).toHaveAttribute('data-fallback', 'resolution');
    await expect(page.getByTestId('measured-resolution')).toHaveText('1920×1080');
    expect(errors).toEqual([]);
  });

  test('the full encode can still be forced (measurement hook) and says so', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __clipExportMode: string }).__clipExportMode = 'encode';
    });
    const errors = await openFixture(page);
    await addMoment(page, '00:02.000', '00:04.000');
    await exportAt720(page);
    const method = page.getByTestId('measured-method');
    await expect(method).toHaveAttribute('data-method', 'encode');
    await expect(method).toHaveAttribute('data-fallback', 'requested_encode');
    await expect(method).toHaveText('Kodlandı');
    const file = await savedFile(page);
    expect(barcodeFrames(file)).toEqual(range(60, 119));
    expect(errors).toEqual([]);
  });
});
