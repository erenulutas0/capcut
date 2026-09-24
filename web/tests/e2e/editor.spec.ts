import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import {
  addKesit,
  closeSheet,
  kesitRanges,
  noHorizontalOverflow,
  noSavePicker,
  openEditor,
  openMore,
  openSettings,
  openVideo,
  opfsFiles,
  installSavePicker,
} from './kesitFlow';

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const SAMPLE_AUDIO = join(process.cwd(), 'tests', 'media', 'tone-30s.m4a');

async function importSample(page: Page) {
  await openVideo(page, SAMPLE_VIDEO);
}

const exportFiles = async (page: Page) =>
  Object.keys(await opfsFiles(page)).filter((name) => name.startsWith('clip-export-'));

test.describe('editor', () => {
  test('reads real metadata from a locally chosen video', async ({ page }) => {
    const errors = await openEditor(page);
    await importSample(page);
    await expect(page.getByTestId('source-meta')).toContainText('sample-24s.mp4');
    await expect(page.getByTestId('total-time')).toHaveText('00:24.000');
    // The frame follows the landscape video.
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-aspect', '16:9');
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
    await expect(page.getByTestId('download-all')).toBeDisabled();
  });

  test('adds, reuses and removes kesitler with real totals', async ({ page }) => {
    await openEditor(page);
    await importSample(page);

    await addKesit(page, '00:00.000', '00:04.000');
    await addKesit(page, '00:08.000', '00:14.000');
    await expect(page.getByTestId('moment-count')).toHaveText('(2)');
    await expect(page.getByTestId('output-duration-us')).toHaveText('10000000');

    // The same range twice is a valid edit.
    await addKesit(page, '00:08.000', '00:14.000');
    await expect(page.getByTestId('moment-count')).toHaveText('(3)');
    await expect(page.getByTestId('output-duration-us')).toHaveText('16000000');
    await expect(kesitRanges(page)).toHaveText(['00:00 → 00:04', '00:08 → 00:14', '00:08 → 00:14']);

    await page.getByTestId('kesit-delete').first().click();
    await expect(page.getByTestId('moment-count')).toHaveText('(2)');
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('moment-count')).toHaveText('(3)');
    await page.getByTestId('redo').click();
    await expect(page.getByTestId('moment-count')).toHaveText('(2)');
  });

  test('rejects invalid ranges instead of creating bad kesitler', async ({ page }) => {
    await openEditor(page);
    await importSample(page);

    await addKesit(page, '00:06.000', '00:02.000');
    await expect(page.getByTestId('range-error')).toContainText('Bitiş zamanı');
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');

    await addKesit(page, '00:20.000', '00:30.000');
    await expect(page.getByTestId('range-error')).toContainText('videonun dışında');
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');

    await addKesit(page, 'saat on', '00:04.000');
    await expect(page.getByTestId('range-start')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('range-error')).toContainText('00:15.000 gibi');
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');
  });

  test('accepts a time typed with an extra leading zero', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:05.000', '00:015.000');
    await expect(page.getByTestId('moment-count')).toHaveText('(1)');
    await expect(page.getByTestId('output-duration-us')).toHaveText('10000000');

    // Leaving the field shows the value as it was understood.
    await page.getByTestId('range-end').fill('20');
    await page.getByTestId('range-end').blur();
    await expect(page.getByTestId('range-end')).toHaveValue('00:20.000');
  });

  test('playback actually advances the media clock', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    const before = await page.getByTestId('source-time-us').textContent();
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Duraklat');
    await expect
      .poll(async () => Number(await page.getByTestId('source-time-us').textContent()), { timeout: 5000 })
      .toBeGreaterThan(Number(before) + 200);
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Oynat');
  });

  test('music plays with a kesit’s ▶ from the start of that kesit', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:08.000', '00:16.000');
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);
    await expect(page.locator('audio.visually-hidden')).toHaveCount(1);

    await page.getByTestId('kesit-play').click();
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
    // Music starts with the downloaded kesit: music time = video time − 8 s.
    const drift = await page.evaluate(() => {
      const audio = document.querySelector<HTMLAudioElement>('audio.visually-hidden');
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!audio || !video) return 999;
      return Math.abs(audio.currentTime - (video.currentTime - 8));
    });
    expect(drift).toBeLessThan(0.5);
    await page.getByTestId('kesit-play').click();
  });

  test('nothing is sent off the machine', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const ownOrigin = new URL(baseURL ?? 'http://127.0.0.1:3100').origin;
    const external: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(`${ownOrigin}/`) && !url.startsWith('blob:') && !url.startsWith('data:')) {
        external.push(url);
      }
    });
    await installSavePicker(page);
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:00.000', '00:02.000');
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);
    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });
    expect(external, `beklenmeyen dış istek: ${external.join(', ')}`).toEqual([]);
  });

  test('aspect presets change the preview frame geometry', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:00.000', '00:04.000');

    const frame = page.getByTestId('preview-frame');
    await openSettings(page, 'frame');
    await page.getByTestId('aspect-9-16').click();
    await closeSheet(page);
    await expect(frame).toHaveAttribute('data-aspect', '9:16');
    let box = await frame.boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(9 / 16, 1);

    await openSettings(page, 'frame');
    await page.getByTestId('aspect-1-1').click();
    await closeSheet(page);
    box = await frame.boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(1, 1);
  });

  test('framing with no kesit is kept and goes to the first kesit', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await openSettings(page, 'frame');
    await page.getByTestId('fit-contain').check();
    await closeSheet(page);
    await addKesit(page, '1', '3');
    await openSettings(page, 'frame');
    await expect(page.getByTestId('fit-contain')).toBeChecked();
    await closeSheet(page);
  });

  test('reads real audio metadata and can remove the music again', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:00.000', '00:04.000');

    await openSettings(page, 'audio');
    await page.getByTestId('audio-input').setInputFiles(SAMPLE_AUDIO);
    await expect(page.getByTestId('music-file-name')).toHaveText('tone-30s.m4a');
    await expect(page.getByTestId('music-in')).toHaveValue('00:00.000');
    await expect(page.getByTestId('music-out')).toHaveValue('00:04.000');

    // The video's own sound applies to every kesit.
    await page.getByTestId('clip-gain').fill('-12');
    await expect(page.getByTestId('clip-gain')).toHaveValue('-12');

    await page.getByTestId('remove-music').click();
    await expect(page.getByTestId('pick-music')).toBeVisible();
  });

  test('without a save dialog: temporary storage while offered, removed afterwards', async ({ page }) => {
    test.setTimeout(120_000);
    await noSavePicker(page);
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:00.000', '00:03.000');

    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('export-download')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('measured-route')).toHaveText('tarayıcının geçici diski');
    await expect(page.getByTestId('measured-resolution')).toHaveText('1920×1080');
    expect(await exportFiles(page)).toHaveLength(1);

    const download = page.waitForEvent('download');
    await page.getByTestId('export-download').click();
    expect((await download).suggestedFilename()).toBe('sample-24s_00-00-00-03.mp4');

    // Dismissing the result stops offering it; the next download deletes the file.
    await page.getByTestId('download-dismiss').click();
    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('export-download')).toBeVisible({ timeout: 120_000 });
    expect(await exportFiles(page)).toHaveLength(1);
  });

  test('a canceled download leaves no temporary file behind', async ({ page }) => {
    test.setTimeout(120_000);
    await noSavePicker(page);
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:00.000', '00:20.000');
    await page.getByTestId('kesit-download').click();
    await expect(page.getByTestId('download-running')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('export-cancel').click();
    await expect(page.getByTestId('export-canceled')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('export-download')).toHaveCount(0);
    await expect.poll(() => exportFiles(page)).toEqual([]);
  });

  test('keyboard shortcuts work and stay out of text fields', async ({ page }) => {
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:00.000', '00:04.000');

    await page.getByTestId('project-title').click();
    await page.keyboard.type('Kahve molası io');
    await expect(page.getByTestId('project-title')).toHaveValue('Kahve molası io');
    // Space and I / O inside the title are just text.
    await page.keyboard.press('Space');
    await expect(page.getByTestId('project-title')).toHaveValue('Kahve molası io ');
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Oynat');
    await expect(page.getByTestId('range-start')).toHaveValue('');

    // Ctrl+Z outside a field undoes the domain edit.
    await page.getByTestId('timeline-playhead').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('moment-count')).toHaveText('(0)');
  });

  test('long Turkish file names do not overflow the page', async ({ page }) => {
    await openEditor(page);
    const longName = 'çok-uzun-türkçe-dosya-adı-ğüşiöç-İstanbul-Şişli-Ağustos-2026-kayıt-düzenlemesi-örnek.mp4';
    await page.getByTestId('video-input').setInputFiles({
      name: longName,
      mimeType: 'video/mp4',
      buffer: readFileSync(SAMPLE_VIDEO),
    });
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await expect(page.getByTestId('source-meta')).toContainText('çok-uzun');
    await noHorizontalOverflow(page);
  });
});

test.describe('layout', () => {
  const widths = [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ];

  for (const size of widths) {
    test(`no horizontal overflow at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      const errors = await openEditor(page);
      await importSample(page);
      await addKesit(page, '00:00.000', '00:04.000');
      await noHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  }

  test('phone width: Ayarlar and Diğer are bottom sheets that Escape dismisses', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await importSample(page);
    await addKesit(page, '00:00.000', '00:04.000');

    const trigger = page.getByTestId('open-settings');
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('aspect-9-16')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await openMore(page);
    await expect(page.getByTestId('find-silences')).toBeVisible();
    await expect(page.getByTestId('backup-download')).toBeVisible();
    await closeSheet(page);
  });

  test('desktop: Ayarlar is a side drawer', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openEditor(page);
    await importSample(page);
    await openSettings(page, 'frame');
    await expect(page.getByTestId('zoom-slider')).toBeVisible();
    const box = await page.getByRole('dialog').boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(1000);
    await closeSheet(page);
  });

  test('landing page has no overflow and links to the editor', async ({ page }) => {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/');
      await noHorizontalOverflow(page);
    }
    await page.getByRole('link', { name: 'Editörü aç' }).first().click();
    await expect(page.getByTestId('download-all')).toBeVisible();
  });
});
