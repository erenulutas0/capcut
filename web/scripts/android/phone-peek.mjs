/**
 * Screenshot and visible state of ONE tab this tooling opened (by CDP target
 * id), to see where a phone run is stuck. Touches no other tab.
 *
 *   node scripts/android/phone-peek.mjs --target=<32-hex id> [--out=peek.png]
 */
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const target = arg('target', '');
if (!/^[0-9A-F]{32}$/.test(target)) {
  console.error('--target=<32-hex CDP target id> required');
  process.exit(2);
}
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
for (const page of context.pages()) {
  const session = await context.newCDPSession(page).catch(() => null);
  if (!session) continue;
  const info = await session.send('Target.getTargetInfo').catch(() => null);
  await session.detach().catch(() => undefined);
  if (info?.targetInfo.targetId !== target) continue;
  await page.screenshot({ path: arg('out', 'peek.png') });
  const state = await page.evaluate(() => ({
    status: document.querySelector('[role="status"]')?.textContent?.slice(0, 200) ?? null,
    progress: document.querySelector('progress')?.value ?? null,
    hasVideo: Boolean(document.querySelector('[data-testid="preview-video"]')),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => d.textContent?.slice(0, 200)),
  }));
  console.log(JSON.stringify(state, null, 1));
}
process.exit(0);
