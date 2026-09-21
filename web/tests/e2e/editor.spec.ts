import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const SAMPLE_AUDIO = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');

async function openEditor(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('open-export')).toBeVisible();
  return errors;
}

async function importSample(page: Page) {
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
}

async function addMoment(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

test.describe('editor', () => {
  test('reads real metadata from a locally chosen video', async ({ page }) => {
    const errors = await openEditor(page);
    await importSample(page);

    await expect(page.getByTestId('source-meta')).toContainText('sample-24s.mp4');
    await expect(page.getByTestId('total-time')).toHaveText('00:24.000');

    await page.getByRole('tab', { name: 'Kaynaklar' }).click();
    await expect(page.getByText('1280×720')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('handles an unreadable file with a visible state, not a crash', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles({
      name: 'bozuk.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('not a real mp4'),
    });
    await expect(page.getByTestId('media-error')).toBeVisible();
    await expect(page.getByTestId('preview-video')).toHaveCount(0);
  });

  test('adds, orders, reuses and removes moments with real totals', async ({ page }) => {
    await openEditor(page);
    await importSample(page);

    await addMoment(page, '00:00.000', '00:04.000');
    await addMoment(page, '00:08.000', '00:14.000');
    await expect(page.getByTestId('moment-count')).toHaveText('2 an');
    await expect(page.getByTestId('output-duration-us')).toHaveText('10000000');
    await expect(page.getByTestId('output-summary')).toContainText('10.0 sn');

    // The same source range twice is a valid edit.
    await addMoment(page, '00:08.000', '00:14.000');
    await expect(page.getByTestId('moment-count')).toHaveText('3 an');
    await expect(page.getByTestId('output-duration-us')).toHaveText('16000000');

    // Reorder without dragging.
    const firstRange = page.getByTestId('moment-card').first().locator('.moment-range');
    await expect(firstRange).toHaveText('00:00.000 — 00:04.000');
    await page.getByTestId('move-down').first().click();
    await expect(firstRange).toHaveText('00:08.000 — 00:14.000');

    await page.getByTestId('undo').click();
    await expect(firstRange).toHaveText('00:00.000 — 00:04.000');
    await page.getByTestId('redo').click();
    await expect(firstRange).toHaveText('00:08.000 — 00:14.000');

    await page.getByTestId('remove-moment').first().click();
    await expect(page.getByTestId('moment-count')).toHaveText('2 an');
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('moment-count')).toHaveText('3 an');
  });

  test('rejects invalid ranges instead of creating bad clips', async ({ page }) => {
    await openEditor(page);
    await importSample(page);

    await addMoment(page, '00:06.000', '00:02.000');
    await expect(page.getByTestId('range-error')).toContainText('Bitiş zamanı');
    await expect(page.getByTestId('moment-count')).toHaveText('0 an');

    await addMoment(page, '00:20.000', '00:30.000');
    await expect(page.getByTestId('range-error')).toContainText('videonun dışında');
    await expect(page.getByTestId('moment-count')).toHaveText('0 an');

    await addMoment(page, 'saat on', '00:04.000');
    await expect(page.getByTestId('range-error')).toContainText('00:00.000 biçiminde');
    await expect(page.getByTestId('moment-count')).toHaveText('0 an');
  });

  test('result mode maps output time onto source time', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');
    await addMoment(page, '00:08.000', '00:14.000');

    await page.getByRole('tab', { name: 'Sonuç' }).click();
    await expect(page.getByTestId('output-note')).toBeVisible();
    await expect(page.getByTestId('total-time')).toHaveText('00:10.000');

    // Output 5 s sits inside the second moment, at source 9 s.
    await page.getByLabel('Zamanda gezin').fill('5000');
    await expect(page.getByTestId('current-time')).toHaveText('00:05.000');
    await expect(page.getByTestId('source-time-us')).toHaveText('9000');
  });

  test('playback actually advances the media clock', async ({ page }) => {
    await openEditor(page);
    await importSample(page);

    const before = await page.getByTestId('source-time-us').textContent();
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Duraklat');
    await expect
      .poll(async () => Number(await page.getByTestId('source-time-us').textContent()), {
        timeout: 5000,
      })
      .toBeGreaterThan(Number(before) + 200);
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Oynat');
  });

  test('result playback crosses the clip boundary onto the next source range', async ({
    page,
  }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:03.000');
    await addMoment(page, '00:12.000', '00:16.000');

    await page.getByRole('tab', { name: 'Sonuç' }).click();
    await page.getByTestId('play-toggle').click();

    // Once output time passes 3 s the player must be inside the SECOND range,
    // i.e. somewhere after source 12 s — not still running at source 3 s.
    await expect
      .poll(
        async () => Number(await page.getByTestId('source-time-us').textContent()),
        { timeout: 12_000 },
      )
      .toBeGreaterThan(12_000);
    await page.getByTestId('play-toggle').click();
  });

  test('music follows the output clock during result playback', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:06.000');
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);
    await expect(page.getByTestId('output-summary')).toContainText('6.0 sn');

    await page.getByRole('tab', { name: 'Sonuç' }).click();
    await page.getByTestId('play-toggle').click();

    // The hidden music element is actually playing and tracks the master clock.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const audio = document.querySelector<HTMLAudioElement>('audio.visually-hidden');
            return audio && !audio.paused ? audio.currentTime : -1;
          }),
        { timeout: 8000 },
      )
      .toBeGreaterThan(0.2);

    const drift = await page.evaluate(() => {
      const audio = document.querySelector<HTMLAudioElement>('audio.visually-hidden');
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!audio || !video) return 999;
      // Moment starts at source 0 and music starts at output 0, so the two
      // clocks should read the same value here.
      return Math.abs(audio.currentTime - video.currentTime);
    });
    expect(drift).toBeLessThan(0.5);
    await page.getByTestId('play-toggle').click();
  });

  test('nothing is sent off the machine', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http://127.0.0.1:3100') && !url.startsWith('blob:') && !url.startsWith('data:')) {
        external.push(url);
      }
    });

    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);
    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-create')).toBeDisabled();

    // Named explicitly so a future failure says WHICH request escaped.
    expect(external, `beklenmeyen dış istek: ${external.join(', ')}`).toEqual([]);
  });

  test('aspect presets change the preview frame geometry', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');

    const frame = page.getByTestId('preview-frame');
    await page.getByTestId('aspect-16-9').click();
    await expect(frame).toHaveAttribute('data-aspect', '16:9');
    let box = await frame.boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);

    await page.getByTestId('aspect-9-16').click();
    await expect(frame).toHaveAttribute('data-aspect', '9:16');
    box = await frame.boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(9 / 16, 1);

    await page.getByTestId('aspect-1-1').click();
    box = await frame.boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(1, 1);
  });

  test('reads real audio metadata and can remove the music again', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');

    await page.getByRole('tab', { name: 'Ses' }).click();
    await page.getByTestId('pick-music').click().catch(() => undefined);
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);

    await expect(page.getByTestId('music-file-name')).toHaveText('tone-30s.m4a');
    await expect(page.getByTestId('music-in')).toHaveValue('00:00.000');
    await expect(page.getByTestId('music-out')).toHaveValue('00:04.000');

    await page.getByTestId('remove-music').click();
    await expect(page.getByTestId('pick-music')).toBeVisible();
  });

  test('export dialog shows real numbers and runs the capability gate', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');
    await addMoment(page, '00:08.000', '00:14.000');

    const trigger = page.getByTestId('open-export');
    await trigger.click();

    await expect(page.getByTestId('export-duration')).toHaveText('10.0 sn');
    await expect(page.getByTestId('export-aspect')).toHaveText('16:9');

    // Creation stays disabled until every stage of the gate has actually run.
    await expect(page.getByTestId('capability-gate')).toBeVisible({ timeout: 60_000 });
    for (const row of ['gate-environment', 'gate-encoder', 'gate-selftest', 'gate-source']) {
      await expect(page.getByTestId(row)).not.toContainText('çalıştırılmadı');
    }

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('produces a real file and reports values read back from it', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:02.000');

    await page.getByTestId('open-export').click();
    await page.getByTestId('export-quality').selectOption('720');
    await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
    await expect(page.getByTestId('export-create')).toBeEnabled();

    await page.getByTestId('export-create').click();
    await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });

    // 2 s at 30 fps, within one frame; measured from the produced file.
    await expect(page.getByTestId('measured-duration')).toContainText(/^00:0[12]\./);
    await expect(page.getByTestId('measured-resolution')).toHaveText('1280×720');
    await expect(page.getByTestId('measured-codecs')).toContainText('avc');
    await expect(page.getByTestId('measured-codecs')).toContainText('aac');

    // The file is offered for saving; nothing is written without the user.
    const download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/\.mp4$/);
  });

  test('writes the output to temporary storage and removes it afterwards', async ({ page }) => {
    const listExportFiles = () =>
      page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names: string[] = [];
        for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
          if (name.startsWith('clip-export-')) names.push(name);
        }
        return names;
      });

    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:03.000');

    await page.getByTestId('open-export').click();
    await page.getByTestId('export-quality').selectOption('720');
    await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
    await page.getByTestId('export-create').click();
    await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });

    // The file went to the browser's temporary storage, not into memory...
    await expect(page.getByTestId('measured-route')).toHaveText('tarayıcının geçici diski');
    // ...and exists there while it is being offered for download.
    expect(await listExportFiles()).toHaveLength(1);

    const download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    expect((await download).suggestedFilename()).toMatch(/\.mp4$/);

    // Closing the dialog stops offering it and deletes the temporary file.
    await page.keyboard.press('Escape');
    await expect.poll(listExportFiles, { timeout: 5000 }).toEqual([]);
  });

  test('a canceled export leaves no temporary file behind', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:20.000');

    await page.getByTestId('open-export').click();
    await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
    await page.getByTestId('export-create').click();
    await page.getByTestId('export-running').waitFor({ timeout: 30_000 });
    await page.getByTestId('export-cancel').click();
    await expect(page.getByTestId('export-canceled')).toBeVisible({ timeout: 60_000 });

    const leftovers = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
        if (name.startsWith('clip-export-')) names.push(name);
      }
      return names;
    });
    expect(leftovers).toEqual([]);
  });

  test('cancel stops the export and produces no file', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    // Long enough that cancel lands while frames are still being encoded.
    await addMoment(page, '00:00.000', '00:20.000');

    await page.getByTestId('open-export').click();
    await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
    await page.getByTestId('export-create').click();

    await page.getByTestId('export-running').waitFor({ timeout: 30_000 });
    await page.getByTestId('export-cancel').click();

    await expect(page.getByTestId('export-canceled')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('export-download')).toHaveCount(0);
    await expect(page.getByTestId('export-succeeded')).toHaveCount(0);
  });

  test('refuses to export a recipe with no moments', async ({ page }) => {
    await openEditor(page);
    await importSample(page);

    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-blocked')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('export-create')).toBeDisabled();
  });

  test('keyboard shortcuts work and stay out of text fields', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');

    await page.getByTestId('project-title').click();
    await page.keyboard.type('Kahve molası');
    await expect(page.getByTestId('project-title')).toHaveValue('Kahve molası');

    // Space inside the title types a space instead of toggling playback.
    await page.keyboard.press('Space');
    await expect(page.getByTestId('project-title')).toHaveValue('Kahve molası ');
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Oynat');

    // Ctrl+Z outside a field undoes the domain edit.
    await page.getByTestId('open-export').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('moment-count')).toHaveText('0 an');
  });

  test('long Turkish file names do not overflow the page', async ({ page }) => {
    await openEditor(page);
    const longName =
      'çok-uzun-türkçe-dosya-adı-ğüşiöç-İstanbul-Şişli-Ağustos-2026-kayıt-düzenlemesi-örnek.mp4';
    await page.getByTestId('video-input').setInputFiles({
      name: longName,
      mimeType: 'video/mp4',
      buffer: require('node:fs').readFileSync(SAMPLE_VIDEO),
    });
    await expect(page.getByTestId('preview-video')).toBeVisible();

    await page.getByRole('tab', { name: 'Kaynaklar' }).click();
    await expect(page.getByTestId('video-file-name')).toContainText('çok-uzun');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('layout', () => {
  const widths = [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ];

  for (const size of widths) {
    test(`no horizontal overflow at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      const errors = await openEditor(page);
      await importSample(page);
      await addMoment(page, '00:00.000', '00:04.000');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }

  test('phone width uses a bottom sheet that Escape dismisses', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');

    const trigger = page.getByTestId('tab-frame');
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('aspect-9-16')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('narrow desktop exposes the inspector as a drawer', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openEditor(page);
    await importSample(page);
    await addMoment(page, '00:00.000', '00:04.000');

    await page.getByTestId('open-inspector-drawer').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('zoom-slider')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('landing page has no overflow and links to the editor', async ({ page }) => {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
    await page.getByRole('link', { name: 'Editörü aç' }).first().click();
    await expect(page.getByTestId('open-export')).toBeVisible();
  });
});
