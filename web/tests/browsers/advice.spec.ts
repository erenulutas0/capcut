import { expect, test } from '@playwright/test';

import { OTHER, t } from '../quality/lib/app';
import { engineOf, watchProblems } from './lib/cells';

/**
 * The fixes of 13 Oct 2026 (docs/quality/browsers-2026-10-13.md):
 *
 * 1. A browser that cannot make the file says so BEFORE the user picks and
 *    chooses — under the wizard's heading — not only after "İndir".
 * 2. The refusal after "İndir" names a way forward, and the right one:
 *    "Chrome ya da Edge ile dene" outside Chrome / Edge, another device on an
 *    iPhone / iPad, nothing inside Chrome / Edge.
 *
 * What is expected is derived from what THIS browser measurably has, not
 * from its name: the day Firefox ships an AAC encoder the notice must go.
 */

test.use({ storageState: { cookies: [], origins: [] } });

interface Has {
  /** WebCodecs, workers and OffscreenCanvas are all there. */
  environment: boolean;
  /** The encoders every download needs say yes. */
  encoders: boolean;
  ios: boolean;
  chromium: boolean;
}

test('tarayıcı dosyayı yapamıyorsa: baştan söylenir ve çıkış yolu doğrudur', async ({ page }, testInfo) => {
  const problems = await watchProblems(page);
  await page.goto('/yap/dikey');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await expect(page.getByTestId('pick-video')).toBeEnabled();

  const has = await page.evaluate(async (): Promise<Has> => {
    const g = window as unknown as Record<string, unknown>;
    type Probe = { isConfigSupported: (config: Record<string, unknown>) => Promise<{ supported?: boolean }> };
    const environment =
      window.isSecureContext &&
      ['Worker', 'VideoEncoder', 'AudioEncoder', 'VideoDecoder', 'AudioDecoder', 'OffscreenCanvas'].every((name) => typeof g[name] === 'function');
    let encoders = false;
    if (environment) {
      try {
        const video = await (g.VideoEncoder as Probe).isConfigSupported({ codec: 'avc1.640028', width: 640, height: 360, bitrate: 1_000_000, framerate: 30 });
        const audio = await (g.AudioEncoder as Probe).isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 });
        encoders = video.supported === true && audio.supported === true;
      } catch {
        encoders = false;
      }
    }
    const agent = navigator.userAgent;
    return {
      environment,
      encoders,
      ios: /\b(iPhone|iPad|iPod)\b/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
      chromium: /\b(Chrome|Chromium|Edg)\//.test(agent),
    };
  });
  const expectedAdvice = has.ios ? 'other_device' : has.chromium ? 'none' : 'try_chromium';
  const adviceText = expectedAdvice === 'none' ? null : t(`browser.advice.${expectedAdvice}`);
  const notice = page.getByTestId('browser-unsupported');

  // --- before a video is picked: known at once only when the browser lacks the basics
  if (!has.environment) {
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(t('browser.cannotExport'));
    await expect(notice).toHaveAttribute('data-advice', expectedAdvice);
    if (adviceText) await expect(notice).toContainText(adviceText);
  } else {
    await expect(notice).toHaveCount(0);
  }

  // --- with the video open
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('pick-video').click()]);
  await chooser.setFiles(OTHER);
  const choose = page.getByTestId('dikey-choice');
  const refused = page.getByTestId('media-error');
  await expect(choose.or(refused).first()).toBeVisible({ timeout: 120_000 });

  if ((await refused.count()) > 0) {
    // The browser cannot even show the video: the refusal is in words and the notice above it says what to do.
    expect(has.environment, 'a browser with the basics opens the test video').toBe(false);
    await expect(notice).toBeVisible();
  } else if (has.environment && has.encoders) {
    // Nothing to say (the control): the notice must not appear, now or after the background check.
    await page.waitForTimeout(3000);
    await expect(notice).toHaveCount(0);
  } else {
    // The background check of the open video finds the missing encoder: said before "İndir".
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice).toHaveAttribute('data-advice', expectedAdvice);
    if (adviceText) await expect(notice).toContainText(adviceText);

    // --- and after "İndir": the refusal, with the same way forward
    await page.getByTestId('wizard-download').click();
    const blocked = page.getByTestId('export-blocked');
    await expect(blocked).toBeVisible({ timeout: 60_000 });
    await expect(blocked).toContainText(t('export.blockedTitle'));
    const advice = page.getByTestId('export-blocked-advice');
    if (adviceText) await expect(advice).toHaveText(adviceText);
    else await expect(advice).toHaveCount(0);
  }

  // Never "try Chrome" inside Chrome, in any state of the page.
  if (engineOf(testInfo) === 'chromium') await expect(page.getByText(t('browser.advice.try_chromium'))).toHaveCount(0);
  expect([...problems.pageErrors, ...problems.unhandledRejections], 'no error nobody was told about').toEqual([]);
});

/**
 * 3. Words typed into the search box before the page is hydrated are not
 *    lost (the page is static HTML first; in WebKit it was usable well before
 *    React owned it, and the box then said "kucult" above an unchanged page).
 *    The page's scripts are held back here, so the order is the same in every engine.
 */
test('ana ekran: sayfa hazır olmadan yazılan arama kaybolmaz', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_next/static/**/*.js', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  const box = page.getByTestId('finder-input');
  await expect(box).toBeVisible();
  await box.fill('kucult');
  // Nothing can have answered yet: no script of the page has run.
  await expect(page.getByTestId('result-kucult')).toHaveCount(0);
  release();
  await expect(page.getByTestId('result-kucult')).toBeVisible({ timeout: 30_000 });
  await expect(box).toHaveValue('kucult');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/yap\/kucult\/?$/);
});
