import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { fastCutFixture, sizedFixture } from './fastcut-media';
import { addKesit, closeSheet, installSavePicker, openEditor, openSettings, openVideo, pickerCalls, probeMp4, readSaved } from './kesitFlow';

/**
 * ADR-041 — the picture is never enlarged, and the editor's default follows
 * the source (11 Oct 2026).
 *
 * Until then the editor opened every video with a 1080p download: a 720p
 * video came back as 1920 × 1080, and because the size was no longer the
 * source's the fast cut (ADR-027) could not be used. The wizards had been
 * given the video's own size on 10–11 Oct; a source under 720p was still
 * enlarged to 720p there.
 *
 * What is checked is the saved file (ffprobe) and the method the app reports
 * for it (`export-method`'s data attributes), never a number the test set.
 */

const METHOD_ATTRIBUTES = ['data-method', 'data-fallback', 'data-frames-encoded'] as const;

async function methodOf(page: Page): Promise<Record<string, string | null>> {
  const method = page.getByTestId('export-method');
  await expect(method).toBeVisible();
  const read: Record<string, string | null> = {};
  for (const name of METHOD_ATTRIBUTES) read[name] = await method.getAttribute(name);
  return read;
}

async function downloadAll(page: Page) {
  await page.getByTestId('download-all').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 180_000 });
}

async function savedSize(page: Page, testInfo: TestInfo): Promise<[number, number]> {
  const name = (await pickerCalls(page)).at(-1);
  expect(name).toBeTruthy();
  const probe = probeMp4(await readSaved(page, testInfo, `saved-${name}`));
  return [probe.width, probe.height];
}

/** What "Ayarlar" says the download will be, read from the screen. */
async function shownSize(page: Page): Promise<{ limit: string; width: string | null; height: string | null; text: string }> {
  await openSettings(page, 'frame');
  const size = page.getByTestId('export-size');
  const shown = {
    limit: await page.getByTestId('export-quality').inputValue(),
    width: await size.getAttribute('data-width'),
    height: await size.getAttribute('data-height'),
    text: (await size.textContent()) ?? '',
  };
  await closeSheet(page);
  return shown;
}

test.describe('the editor’s default follows the source', () => {
  test('a 720p video opened straight in the editor downloads at 1280 × 720 by the fast cut — the same method as in the “Kes” wizard', async ({
    page,
  }, testInfo) => {
    // 1. The editor, opened directly; "Ayarlar" is only read, never changed.
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, fastCutFixture());
    const shown = await shownSize(page);
    expect(shown.limit).toBe('1080');
    expect([shown.width, shown.height]).toEqual(['1280', '720']);
    expect(shown.text).toContain('İndirilen video 1280 × 720 olur.');
    expect(shown.text).toContain('Videon büyütülmez');
    // Frames 60..119: one IDR to the next.
    await addKesit(page, '00:02.000', '00:04.000');
    await downloadAll(page);
    const inEditor = await methodOf(page);
    expect(await savedSize(page, testInfo)).toEqual([1280, 720]);
    expect(inEditor['data-method']).toBe('copy');
    expect(inEditor['data-fallback']).toBe('');

    // 2. The same video and the same kesit through the wizard.
    await page.goto('/');
    await page.getByTestId('task-kes').click();
    await page.getByTestId('video-input').setInputFiles(fastCutFixture());
    await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
    await addKesit(page, '00:02.000', '00:04.000');
    await downloadAll(page);
    const inWizard = await methodOf(page);
    expect(await savedSize(page, testInfo)).toEqual([1280, 720]);

    expect(inEditor).toEqual(inWizard);
    expect(errors).toEqual([]);
  });

  test('a kesit cut off the keyframes: smart cut in the editor too, with nothing set', async ({ page }, testInfo) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, fastCutFixture());
    await addKesit(page, '00:01.100', '00:04.000');
    await downloadAll(page);
    const method = await methodOf(page);
    expect(method['data-method']).toBe('smart');
    expect(method['data-fallback']).toBe('');
    expect(await savedSize(page, testInfo)).toEqual([1280, 720]);
    expect(errors).toEqual([]);
  });

  for (const [width, height] of [
    [640, 360],
    [854, 480],
    [360, 640],
  ] as const) {
    test(`a ${width} × ${height} video is not enlarged and is cut fast (it used to become 720p or 1080p, re-encoded)`, async ({
      page,
    }, testInfo) => {
      await installSavePicker(page);
      const errors = await openEditor(page);
      await openVideo(page, sizedFixture(width, height));
      const shown = await shownSize(page);
      expect([shown.width, shown.height]).toEqual([String(width), String(height)]);
      await addKesit(page, '00:02.000', '00:04.000');
      await downloadAll(page);
      const method = await methodOf(page);
      expect(await savedSize(page, testInfo)).toEqual([width, height]);
      expect(method['data-method']).toBe('copy');
      expect(method['data-fallback']).toBe('');
      expect(errors).toEqual([]);
    });
  }

  test('the limit is a limit: “En çok 720p” makes a 1080p video 1280 × 720 — encoded, and the result says why', async ({ page }, testInfo) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, sizedFixture(1920, 1080));
    await addKesit(page, '00:02.000', '00:04.000');
    await openSettings(page, 'frame');
    await expect(page.getByTestId('export-quality').locator('option')).toHaveText(['Videonun kendi boyutu (en çok 1080p)', 'En çok 720p']);
    await expect(page.getByTestId('export-size')).toHaveAttribute('data-width', '1920');
    await page.getByTestId('export-quality').selectOption('720');
    await expect(page.getByTestId('export-size')).toHaveAttribute('data-width', '1280');
    await expect(page.getByTestId('export-size')).toHaveAttribute('data-rule', 'ceiling');
    await closeSheet(page);
    await downloadAll(page);
    expect(await savedSize(page, testInfo)).toEqual([1280, 720]);
    const method = await methodOf(page);
    expect(method['data-method']).toBe('encode');
    expect(method['data-fallback']).toBe('resolution');
    // In plain words on the result, in engineering words behind "Ayrıntılar".
    await expect(page.getByTestId('export-method')).toHaveText('Görüntü yeniden işlendi (görüntünün boyutu videonunkinden farklı)');
    await page.getByTestId('export-succeeded').getByText('Ayrıntılar').click();
    await expect(page.getByTestId('measured-method')).toHaveText('Yeniden kodlandı (çözünürlük kaynağınkinden farklı)');
    await expect(page.getByTestId('measured-resolution')).toHaveText('1280×720');
    expect(errors).toEqual([]);
  });

  test('a 1080p video at the default is 1920 × 1080, untouched', async ({ page }, testInfo) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, sizedFixture(1920, 1080));
    await addKesit(page, '00:02.000', '00:04.000');
    await downloadAll(page);
    expect(await savedSize(page, testInfo)).toEqual([1920, 1080]);
    expect((await methodOf(page))['data-method']).toBe('copy');
    expect(errors).toEqual([]);
  });

  test('the limit set to 720p on a 360p video changes nothing: 640 × 360, untouched', async ({ page }, testInfo) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, sizedFixture(640, 360));
    await addKesit(page, '00:02.000', '00:04.000');
    await openSettings(page, 'frame');
    await page.getByTestId('export-quality').selectOption('720');
    await expect(page.getByTestId('export-size')).toHaveAttribute('data-width', '640');
    await expect(page.getByTestId('export-size')).toHaveAttribute('data-rule', 'source');
    await closeSheet(page);
    await downloadAll(page);
    expect(await savedSize(page, testInfo)).toEqual([640, 360]);
    expect((await methodOf(page))['data-method']).toBe('copy');
    expect(errors).toEqual([]);
  });

  test('zooming in keeps the pixels that are left: a 720p video at 150 % is 854 × 480, not 1920 × 1080', async ({ page }, testInfo) => {
    await installSavePicker(page);
    const errors = await openEditor(page);
    await openVideo(page, fastCutFixture());
    await addKesit(page, '00:02.000', '00:03.000');
    await openSettings(page, 'frame');
    await page.getByTestId('zoom-slider').fill('150');
    await expect(page.getByTestId('export-size')).toHaveAttribute('data-height', '480');
    await closeSheet(page);
    await downloadAll(page);
    const [width, height] = await savedSize(page, testInfo);
    expect(height).toBe(480);
    expect(width * height).toBeLessThanOrEqual(1280 * 720);
    const method = await methodOf(page);
    expect(method['data-method']).toBe('encode');
    expect(method['data-fallback']).toBe('crop');
    expect(errors).toEqual([]);
  });
});
