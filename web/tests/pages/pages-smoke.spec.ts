import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

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

/** Moves the timeline playhead to a whole second with the keyboard. */
async function playheadTo(page: Page, seconds: number) {
  await page.getByTestId('timeline-playhead').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < seconds; i += 1) await page.keyboard.press('Shift+ArrowRight');
}

test('landing → editor → timeline cuts, caption, silence, export, report, privacy', async ({ page, context }) => {
  const seen = watchRequests(page);

  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: /Editörü aç/ }).first().click();
  await expect(page).toHaveURL(/\/capcut\/editor\/?$/);

  // The single timeline (ADR-019): the video arrives whole, as one piece.
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  await expect(page.getByTestId('strip-clip')).toHaveCount(1);

  // Cut at 4 s, 8 s and 14 s; delete the second and the last piece.
  for (const at of [4, 8, 14]) {
    await playheadTo(page, at);
    await page.keyboard.press('s');
  }
  await expect(page.getByTestId('strip-clip')).toHaveCount(4);
  await page.getByTestId('strip-clip').nth(3).getByRole('button').click();
  await page.getByTestId('delete-selected').click();
  await page.getByTestId('strip-clip').nth(1).getByRole('button').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('moment-card').locator('.moment-range')).toHaveText([
    '00:00.000 — 00:04.000',
    '00:08.000 — 00:14.000',
  ]);
  await expect(page.getByTestId('timeline-notice')).toContainText('Parça 02 silindi');

  // Caption: needs the bundled font from /capcut/fonts/caption/.
  await page.getByRole('tab', { name: 'Altyazı' }).click();
  await page.getByTestId('captions-add').click();
  const field = page.getByTestId('cue-draft').getByTestId('cue-text');
  await expect(field).toBeFocused();
  await page.keyboard.type('Yayında altyazı');
  await field.blur();
  await expect(page.getByTestId('cue-draft')).toHaveCount(0);
  await expect(page.getByTestId('caption-font-failed')).toHaveCount(0);

  // Silence analysis: its own worker script, served from the sub-path.
  await page.getByTestId('open-silence').click();
  const silence = page.getByRole('dialog', { name: 'Sessizlikleri bul' });
  await expect(silence.getByTestId('silence-clips')).toBeVisible({ timeout: 60_000 });
  await expect(silence.getByTestId('silence-problem')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Export with the caption: export worker + font inside the worker.
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-ready').waitFor({ timeout: 90_000 });
  await page.getByTestId('export-create').click();
  await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  expect((await download).suggestedFilename()).toMatch(/\.mp4$/);
  await page.keyboard.press('Escape');

  // Report dialog: contact is the public issue tracker, with the warning.
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
