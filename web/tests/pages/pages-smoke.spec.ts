import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { addKesit, closeSheet, openMore, openSettings, installSavePicker } from '../e2e/kesitFlow';

/**
 * The published build, under /capcut/, end to end: every thing that resolves
 * a URL at runtime (Next chunks, the export and silence workers, the caption
 * font, plain links, the report dialog's contact) is exercised once, and no
 * request may 404 or leave the origin.
 */

const SAMPLE_VIDEO = join(__dirname, '..', 'media', 'sample-24s.mp4');

function watchRequests(page: Page) {
  const failures: string[] = [];
  const outside: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('blob:') && !url.startsWith('data:')) {
      outside.push(url);
    }
    if (url.startsWith('http://127.0.0.1:') && !new URL(url).pathname.startsWith('/capcut/')) {
      failures.push(`outside base path: ${url}`);
    }
  });
  return { failures, outside };
}

/** Moves the strip's playhead to a whole second with the keyboard. */
async function playheadTo(page: Page, seconds: number) {
  await page.getByTestId('timeline-playhead').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < seconds; i += 1) await page.keyboard.press('Shift+ArrowRight');
}

test('landing → editor → kesitler, caption, silence, download, report, privacy', async ({ page, context }) => {
  const seen = watchRequests(page);
  await installSavePicker(page);

  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: /Editörü aç/ }).first().click();
  await expect(page).toHaveURL(/\/capcut\/editor\/?$/);

  // The kesit list (ADR-026): mark with I / O, Enter adds; one more typed.
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await playheadTo(page, 0);
  await page.keyboard.press('i');
  await playheadTo(page, 4);
  await page.keyboard.press('o');
  await page.keyboard.press('Enter');
  await addKesit(page, '8', '14');
  await addKesit(page, '16', '18');
  await page.getByTestId('kesit-delete').nth(2).click();
  await expect(page.getByTestId('kesit-range')).toHaveText(['00:00 → 00:04', '00:08 → 00:14']);
  await expect(page.getByTestId('timeline-notice')).toContainText('Kesit 3 silindi');

  // Caption: needs the bundled font from /capcut/fonts/caption/.
  await openSettings(page, 'captions');
  await page.getByTestId('captions-add').click();
  const field = page.getByTestId('cue-draft').getByTestId('cue-text');
  await expect(field).toBeFocused();
  await page.keyboard.type('Yayında altyazı');
  await field.blur();
  await expect(page.getByTestId('cue-draft')).toHaveCount(0);
  await expect(page.getByTestId('caption-font-failed')).toHaveCount(0);
  await closeSheet(page);

  // Silence analysis: its own worker script, served from the sub-path.
  await openMore(page);
  await page.getByTestId('find-silences').click();
  const silence = page.getByRole('dialog', { name: 'Sessizlikleri bul' });
  await expect(silence.getByTestId('silence-clips')).toBeVisible({ timeout: 60_000 });
  await expect(silence.getByTestId('silence-problem')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Download both joined, with the caption: export worker + font inside the
  // worker, straight into the file picked in the (stand-in) save dialog.
  await page.getByTestId('download-all').click();
  await expect(page.getByTestId('download-saved')).toHaveText('Kaydedildi: saved-sample-24s_2-kesit.mp4', {
    timeout: 180_000,
  });

  // Report dialog: contact is the public issue tracker, with the warning.
  await openMore(page);
  await page.getByTestId('open-help').click();
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('support-open-issue')).toHaveAttribute(
    'href',
    'https://github.com/erenulutas0/capcut/issues',
  );
  await expect(page.getByTestId('support-public-warning')).toBeVisible();

  // Privacy link opens a new tab under the base path, with the host filled in.
  const [privacy] = await Promise.all([
    context.waitForEvent('page'),
    page.getByTestId('report-privacy-link').click(),
  ]);
  const privacySeen = watchRequests(privacy);
  await privacy.waitForLoadState();
  await expect(privacy).toHaveURL(/\/capcut\/gizlilik\/?$/);
  await expect(privacy.getByTestId('privacy-draft')).toBeVisible();
  await expect(privacy.getByText('GitHub Pages (GitHub, Inc.)')).toBeVisible();

  expect(seen.failures).toEqual([]);
  expect(seen.outside).toEqual([]);
  expect(privacySeen.failures).toEqual([]);
  expect(privacySeen.outside).toEqual([]);
});
