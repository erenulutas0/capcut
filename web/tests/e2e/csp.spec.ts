import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { expectPolicy, watchCsp } from './cspWatch';
import { fastCutFixture } from './fastcut-media';
import { hdrFixture } from './hdr-media';
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

  for (const path of ['/', '/editor', '/gizlilik', '/gizlilik/en']) {
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

test('a full editor session raises no CSP violation', async ({ page, context }, testInfo) => {
  test.setTimeout(900_000);
  const csp = await watchCsp(context);
  await csp.attach(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installSavePicker(page);

  // Landing, then the editor by a client-side navigation: the landing
  // page's policy stays in force for the rest of this document.
  await page.goto('/');
  await expectPolicy(page);
  await page.getByRole('link', { name: /Editörü aç/ }).first().click();
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
