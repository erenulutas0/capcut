/**
 * Which AAC bitrates a browser's `AudioEncoder` accepts, and what its H.264
 * encoder says about the small sizes the target-size planner uses (ADR-035).
 *
 *   node scripts/android/aac-bitrate-probe.mjs --desktop=chrome|msedge|chromium [--url=http://127.0.0.1:3100/]
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   adb reverse tcp:3100 tcp:3100
 *   node scripts/android/aac-bitrate-probe.mjs [--url=http://localhost:3100/]
 *
 * On the phone it opens ONE tab of its own (through `cdp-own-tabs.mjs`, so
 * no other tab is seen), asks the questions, clears the site's storage and
 * closes that tab. It never closes the browser.
 */
import { chromium } from '@playwright/test';

import { ownTabsEndpoint } from './cdp-own-tabs.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const desktop = arg('desktop', '');
const url = arg('url', desktop ? 'http://127.0.0.1:3100/' : 'http://localhost:3100/');

const browser = desktop
  ? await chromium.launch({ channel: desktop === 'chromium' ? undefined : desktop })
  : await chromium.connectOverCDP(await ownTabsEndpoint('http://127.0.0.1:9222', { show: [] }), { timeout: 180_000 });
const context = desktop ? await browser.newContext() : browser.contexts()[0];
const page = await context.newPage();
try {
  await page.goto(url, { waitUntil: 'load' });
  const answer = await page.evaluate(async () => {
    const audio = {};
    for (const bitrate of [32000, 48000, 64000, 80000, 96000, 112000, 128000, 160000, 192000]) {
      try {
        const support = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          sampleRate: 48000,
          numberOfChannels: 2,
          bitrate,
          aac: { format: 'aac' },
        });
        audio[bitrate] = support.supported === true;
      } catch (error) {
        audio[bitrate] = `error: ${error.name}`;
      }
    }
    const video = {};
    for (const [width, height] of [[1080, 1920], [720, 1280], [540, 960], [360, 640], [1920, 1080], [640, 360]]) {
      const row = {};
      for (const hardwareAcceleration of ['no-preference', 'prefer-hardware', 'prefer-software']) {
        for (const bitrateMode of ['variable', 'constant']) {
          try {
            const support = await VideoEncoder.isConfigSupported({
              codec: 'avc1.640028',
              width,
              height,
              bitrate: Math.round(width * height * 30 * 0.04),
              framerate: 30,
              hardwareAcceleration,
              bitrateMode,
            });
            row[`${hardwareAcceleration}/${bitrateMode}`] = support.supported === true;
          } catch (error) {
            row[`${hardwareAcceleration}/${bitrateMode}`] = `error: ${error.name}`;
          }
        }
      }
      video[`${width}x${height}`] = row;
    }
    return { userAgent: navigator.userAgent.replace(/\(.*?\)/, '(…)'), audio, video };
  });
  console.log(JSON.stringify(answer, null, 2));
} finally {
  await page
    .evaluate(async () => {
      for (const registration of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) {
        await registration.unregister().catch(() => undefined);
      }
      for (const key of (await globalThis.caches?.keys?.()) ?? []) await caches.delete(key).catch(() => undefined);
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
    })
    .catch(() => undefined);
  await page.close().catch(() => undefined);
  if (desktop) await browser.close();
}
// Only disconnect: never close the phone's own browser.
process.exit(0);
