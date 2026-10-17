import { expect, type Page } from './fixtures';

/**
 * "LiloCut'a paylaş" (ADR-047) in a test: what Android's share sheet does, and what is left of it.
 * Used by tests/e2e/share-target.spec.ts and the Pages smoke test (tests/pages/pages-smoke.spec.ts).
 */

export async function waitForWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state))
    .toBe('activated');
}

/**
 * The share sheet's request: a top-level navigation POST of `multipart/form-data` to the share
 * target's address (`action`, absolute), the files in the field `video` (manifest
 * `share_target.params.files`). Made from a blank page — another app, not ours: our pages forbid
 * forms (`form-action 'none'`), and the share sheet is no form of ours either. Resolves on the
 * address the share ended on, once that page has loaded.
 */
export async function shareFiles(page: Page, files: string[], action: string): Promise<URL> {
  await page.goto('about:blank');
  await page.setContent(
    `<form id="share" method="post" enctype="multipart/form-data" action="${action}">` +
      '<input id="files" type="file" name="video" multiple></form>',
  );
  await page.setInputFiles('#files', files);
  await Promise.all([
    page.waitForURL((url) => url.protocol.startsWith('http'), { waitUntil: 'load' }),
    page.evaluate(() => window.setTimeout(() => (document.getElementById('share') as HTMLFormElement).submit(), 0)),
  ]);
  return new URL(page.url());
}

/** The stored shared videos (entry paths), or null when there is no `clip-shared` cache at all. */
export async function storedShares(page: Page): Promise<string[] | null> {
  return page.evaluate(async () => {
    if (!(await caches.has('clip-shared'))) return null;
    const cache = await caches.open('clip-shared');
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
}
