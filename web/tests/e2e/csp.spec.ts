import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { expectPolicy, watchCsp } from './cspWatch';
import { availableTasks } from '../../src/domain/tasks';
import { fastCutFixture } from './fastcut-media';
import { hdrFixture } from './hdr-media';
import { silenceFixture } from './silence-media';
import {
  addKesit,
  closeSheet,
  installSavePicker,
  openMore,
  openSettings,
  openVideo,
  pickerCalls,
  playheadTo,
} from './kesitFlow';

/**
 * The Content-Security-Policy written into every built page
 * (scripts/apply-csp.mjs, docs/security/2026-09-30-static-site-hardening.md)
 * is present, is enforced, and a whole editor session never trips it.
 *
 * Runs in the suite's Chromium; `E2E_CHANNEL=chrome` or `E2E_CHANNEL=msedge`
 * runs the same checks in installed Chrome or Edge.
 */

test.use({ channel: process.env.E2E_CHANNEL || undefined });

async function setQuality720(page: Page) {
  await openSettings(page, 'frame');
  await page.getByTestId('export-quality').selectOption('720');
  await closeSheet(page);
}

test('every page carries the policy, and the policy is enforced', async ({ page, context }) => {
  const csp = await watchCsp(context);
  await csp.attach(page);

  // The opening screen, the editor, the privacy pages and every task wizard (ADR-034).
  const wizards = availableTasks().map((task) => `/yap/${task.id}`);
  expect(wizards.length).toBeGreaterThanOrEqual(5);
  for (const path of ['/', '/editor', '/gizlilik', '/gizlilik/en', ...wizards]) {
    await page.goto(path);
    await expect(page.locator('h1, [data-testid="download-all"]').first()).toBeVisible();
    await expectPolicy(page);
  }
  // Not-found page too (its own inline <style>).
  const missing = await page.goto('/no-such-page');
  expect(missing?.status()).toBe(404);
  await expectPolicy(page);
  expect(csp.violations, csp.violations.join('\n')).toEqual([]);

  // Negative control: the watcher sees a violation, and the browser blocks
  // an injected inline script and eval.
  await page.goto('/editor');
  const blocked = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true';
    document.head.appendChild(script);
    // Code evaluated by the test driver bypasses the policy, so eval is
    // tried where page code runs: a blob: worker inherits the page's policy.
    const code = 'try { eval("1"); postMessage("allowed") } catch (e) { postMessage(e.name) }';
    const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const evalResult = await new Promise<string>((resolve) => {
      worker.onmessage = (event) => resolve(String(event.data));
    });
    worker.terminate();
    return { injected: (window as unknown as { __injected?: boolean }).__injected === true, evalResult };
  });
  expect(blocked).toEqual({ injected: false, evalResult: 'EvalError' });
  await expect.poll(() => csp.violations.some((v) => v.includes('script-src'))).toBe(true);
});

/**
 * ADR-034: the opening screen and the task wizards are new pages with new
 * markup (the search listbox, the radio cards, the 9:16 preview, an <audio>
 * player on a blob: URL, the analysis progress bar). One session through
 * every wizard to its saved file, and the editor opened in place.
 */
test('the opening screen and every wizard, to the saved file, raise no CSP violation', async ({ page, context }) => {
  test.setTimeout(600_000);
  const csp = await watchCsp(context);
  await csp.attach(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installSavePicker(page);
  const other = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');
  const saved = async () => {
    await page.getByTestId('wizard-download').click();
    await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 180_000 });
  };

  await page.goto('/');
  await expectPolicy(page);
  for (const phrase of ['tiktok için kes', 'videom whatsapp’a sığmıyor', 'pizza siparişi']) {
    await page.getByTestId('finder-input').fill(phrase);
  }
  await page.getByTestId('finder-show-all').click();

  // Kes: by its card (a client-side navigation), then the editor in place.
  await page.getByTestId('task-kes').click();
  await page.getByTestId('video-input').setInputFiles(other);
  await expect(page.getByTestId('preview-video')).toBeVisible({ timeout: 60_000 });
  await addKesit(page, '1', '3');
  await page.getByTestId('kesit-download').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 120_000 });

  // Boşlukları at: the analysis worker, the progress bar, the joined download.
  await page.goto('/yap/bosluk');
  await expectPolicy(page);
  await page.getByTestId('video-input').setInputFiles(silenceFixture('showcase').file);
  await expect(page.getByTestId('bosluk-found')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('option-short').check();
  await saved();

  // Dikey yap: the 9:16 preview, both choices, the preview playing.
  await page.goto('/yap/dikey');
  await page.getByTestId('video-input').setInputFiles(other);
  await expect(page.getByTestId('dikey-choice')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('option-contain').check();
  await page.getByTestId('wizard-play').click();
  await page.getByTestId('wizard-play').click();
  await saved();
  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('preview-video')).toBeVisible();

  // Müzik ekle: the music file plays from a blob: URL.
  await page.goto('/yap/muzik');
  await page.getByTestId('video-input').setInputFiles(other);
  await expect(page.getByTestId('muzik-pick')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('audio-input').setInputFiles(join(process.cwd(), 'tests', 'media', 'tone-30s.m4a'));
  await expect(page.getByTestId('muzik-picked')).toBeVisible();
  await saved();

  // Her yerde açılsın, and a refused file (the error markup).
  await page.goto('/yap/cevir');
  await page.getByTestId('video-input').setInputFiles({ name: 'not.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByTestId('media-error')).toBeVisible();
  await page.getByTestId('video-input').setInputFiles(other);
  await expect(page.getByTestId('cevir-info')).toBeVisible({ timeout: 60_000 });
  await saved();

  expect(await pickerCalls(page).then((calls) => calls.length)).toBe(1);
  expect(errors).toEqual([]);
  expect(csp.violations, csp.violations.join('\n')).toEqual([]);
});

test('a full editor session raises no CSP violation', async ({ page, context }, testInfo) => {
  test.setTimeout(900_000);
  const csp = await watchCsp(context);
  await csp.attach(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installSavePicker(page);

  // The opening screen, then the editor by a client-side navigation
  // ("Kendim düzenleyeceğim"): the opening screen's policy stays in force
  // for the rest of this document.
  await page.goto('/');
  await expectPolicy(page);
  await page.getByTestId('finder-input').fill('tiktok için dikey');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByTestId('finder-clear').click();
  await page.getByRole('link', { name: 'Kendim düzenleyeceğim' }).click();
  await expect(page.getByTestId('download-all')).toBeVisible();

  // Open a video (preview from a blob: URL, filmstrip thumbnails).
  await openVideo(page, fastCutFixture());
  await setQuality720(page);

  // One kesit on keyframes: the fast cut (copied pictures).
  await addKesit(page, '00:02.000', '00:04.000');
  await page.getByTestId('download-all').click();
  await expect(page.getByTestId('download-saved')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('export-method')).toHaveAttribute('data-method', /^(copy|smart)$/);

  // A second kesit and a caption: the full encode in the worker, with the
  // caption font loaded from the app origin.
  await addKesit(page, '00:05.500', '00:08.900');
  // The caption goes where the playhead is: inside the first kesit.
  await playheadTo(page, 3);
  await openSettings(page, 'captions');
  await page.getByTestId('captions-add').click();
  const field = page.getByTestId('cue-draft').getByTestId('cue-text');
  await expect(field).toBeFocused();
  await page.keyboard.type('Güvenlik politikası');
  await field.blur();
  await expect(page.getByTestId('cue-draft')).toHaveCount(0);

  // Subtitle file download (blob: link).
  let download = page.waitForEvent('download');
  await page.getByTestId('caption-export-srt').click();
  expect((await download).suggestedFilename()).toMatch(/\.srt$/);
  await closeSheet(page);

  await page.getByTestId('download-all').click();
  await expect.poll(() => pickerCalls(page).then((calls) => calls.length), { timeout: 30_000 }).toBe(2);
  await expect(page.getByTestId('download-saved')).toContainText('2-kesit', { timeout: 240_000 });
  await expect(page.getByTestId('export-method')).toHaveAttribute('data-method', 'encode');

  // Silence analysis (its own worker).
  await openMore(page);
  await page.getByTestId('find-silences').click();
  await expect(page.getByRole('dialog', { name: 'Sessizlikleri bul' })).toBeVisible();
  await expect(page.getByTestId('silence-running')).toHaveCount(0, { timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Project backup, then restore from that file.
  await openMore(page);
  download = page.waitForEvent('download');
  await page.getByTestId('backup-download').click();
  const backup = await download;
  const backupPath = testInfo.outputPath('csp.clip.json');
  await backup.saveAs(backupPath);
  await closeSheet(page);
  await page.getByTestId('backup-input').setInputFiles(backupPath);
  await expect(page.getByTestId('kesit-card')).toHaveCount(2);

  // Diagnostics file and the privacy page in a new tab.
  await openMore(page);
  await page.getByTestId('open-help').click();
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false');
  download = page.waitForEvent('download');
  await page.getByTestId('diag-download').click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  const [privacy] = await Promise.all([context.waitForEvent('page'), page.getByTestId('report-privacy-link').click()]);
  await privacy.waitForLoadState();
  await expect(privacy.getByTestId('privacy-draft')).toBeVisible();
  await expectPolicy(privacy);
  await privacy.close();
  await page.keyboard.press('Escape');

  // A fresh load of the editor (its own policy), then an HDR source: the
  // tone-mapping check and the HDR encode path.
  await page.goto('/editor');
  await expectPolicy(page);
  // By now the service worker (ADR-031) is active: this load, and the HDR
  // export's worker below, come from its stored copy, under the same policy.
  expect(
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      return Boolean(navigator.serviceWorker.controller);
    }),
  ).toBe(true);
  await openVideo(page, hdrFixture());
  await setQuality720(page);
  await page.getByTestId('download-all').click();
  await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
  await expect(page.getByTestId('export-hdr-note')).toContainText('SDR');

  await page.waitForTimeout(500);
  expect(csp.violations, csp.violations.join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});

test('a sample file opens and plays under the policy', async ({ page, context }) => {
  const csp = await watchCsp(context);
  await csp.attach(page);
  await page.goto('/editor');
  await openVideo(page, join(process.cwd(), 'tests', 'media', 'sample-24s.mp4'));
  await page.getByTestId('play-toggle').click();
  await expect
    .poll(() => page.getByTestId('preview-video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.2);
  expect(csp.violations, csp.violations.join('\n')).toEqual([]);
});
