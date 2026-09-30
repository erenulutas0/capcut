/**
 * Cleans up after a phone run that was cut off (adb dropped the forward, the
 * phone locked): closes the tabs this tooling opened and deletes what the app
 * stored for the site. Only tabs created over CDP are touched — Chrome for
 * Android lists those with a 32-hex-digit id, tabs the phone's owner opened
 * have short numeric ids — and only when they show the given site.
 *
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   node scripts/android/phone-cleanup.mjs [--site=https://erenulutas0.github.io/capcut/]
 */
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const site = arg('site', 'https://erenulutas0.github.io/capcut/');

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ours = new Set(
  targets.filter((t) => t.type === 'page' && /^[0-9A-F]{32}$/.test(t.id) && t.url.startsWith(site)).map((t) => t.id),
);
console.log(`tabs opened over CDP on ${site}: ${ours.size}`);
if (ours.size === 0) process.exit(0);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
let cleaned = false;
for (const page of context.pages()) {
  if (!page.url().startsWith(site)) continue;
  const session = await context.newCDPSession(page);
  const { targetInfo } = await session.send('Target.getTargetInfo');
  await session.detach();
  if (!ours.has(targetInfo.targetId)) continue;
  if (!cleaned) {
    // Site data is per origin: once is enough.
    await page
      .evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
        for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
        try {
          localStorage.clear();
        } catch {
          /* ignore */
        }
        // ADR-031: the site's service worker and its precache.
        for (const registration of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) {
          await registration.unregister().catch(() => undefined);
        }
        for (const key of (await globalThis.caches?.keys?.()) ?? []) await caches.delete(key).catch(() => undefined);
      })
      .then(() => {
        cleaned = true;
      })
      .catch((error) => console.log(`storage cleanup failed: ${error.message}`));
  }
  await page.close();
  console.log(`closed ${targetInfo.targetId}`);
}
console.log(`site storage cleared: ${cleaned}`);
// Only disconnect: never close the phone's own browser.
process.exit(0);
