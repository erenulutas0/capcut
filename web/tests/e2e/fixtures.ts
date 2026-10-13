/**
 * What every e2e spec imports instead of '@playwright/test' (ADR-044).
 *
 * A page that does not come alive now reloads itself once (src/pageWatchdog.ts)
 * — in a test exactly as for a user. That must not make a flaky load
 * invisible: this fixture, on for every test without being asked for, watches
 * every page of every browser context the test opens and reports
 *
 *   PAGE-RECOVERED <url> — <test>     a load that needed the automatic reload
 *   PAGE-DEAD <url> — <test>          a page still showing "Sayfa tam açılamadı" when the test ended
 *
 * as a line on the output and as an annotation on the test
 * (`page-recovered` / `page-dead`). tests/e2e/recoveryReporter.ts adds the
 * run's total. A test that breaks a load on purpose says so with
 * `expectPageRecovery()`; its recoveries are counted apart (`…-forced`).
 *
 * There are no Playwright `retries` here, on purpose: a retry hides what
 * this prints.
 */
import { test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { PAGE_NOTICE_ID, PAGE_RECOVERED_LOG } from '../../src/pageWatchdog';

export * from '@playwright/test';

const FORCED = 'page-recovery-forced-by-test';

/** In a test that breaks a page load on purpose: its recoveries are not the run's findings. */
export function expectPageRecovery(): void {
  base.info().annotations.push({ type: FORCED });
}

export const test = base.extend<{ pageRecoveryWatch: void }>({
  pageRecoveryWatch: [
    async ({ browser }, use, testInfo) => {
      const recovered: string[] = [];
      const dead: string[] = [];
      const contexts = new Set<BrowserContext>();
      /** Pages of a context that still show "Sayfa tam açılamadı": asked just before the context goes away. */
      const collectDead = async (context: BrowserContext) => {
        for (const page of context.pages()) {
          const state = await page
            .evaluate((id) => document.getElementById(id)?.getAttribute('data-state') ?? null, PAGE_NOTICE_ID)
            .catch(() => null);
          if (state === 'dead') dead.push(page.url());
        }
      };
      const watchPage = (page: Page) => {
        page.on('console', (message) => {
          if (message.text().startsWith(PAGE_RECOVERED_LOG)) recovered.push(page.url());
        });
      };
      const watchContext = (context: BrowserContext) => {
        contexts.add(context);
        context.on('page', watchPage);
        for (const page of context.pages()) watchPage(page);
        // The built-in `context` fixture closes its context before this fixture is torn down.
        const close = context.close.bind(context);
        context.close = async (...args: Parameters<BrowserContext['close']>) => {
          if (contexts.delete(context)) await collectDead(context);
          return close(...args);
        };
      };
      // The built-in `context` fixture and a test's own `browser.newContext()` both come through here.
      const patched = browser as Browser & { newContext: Browser['newContext'] };
      const original = patched.newContext;
      patched.newContext = async function newContext(this: Browser, ...args: Parameters<Browser['newContext']>) {
        const context = await original.apply(this, args);
        watchContext(context);
        return context;
      };
      for (const context of browser.contexts()) watchContext(context);

      await use();

      patched.newContext = original;
      // Contexts the test left open.
      for (const context of [...contexts]) {
        contexts.delete(context);
        await collectDead(context);
      }
      const forced = testInfo.annotations.some((annotation) => annotation.type === FORCED);
      const name = testInfo.titlePath.slice(1).join(' › ');
      for (const url of recovered) {
        testInfo.annotations.push({ type: forced ? 'page-recovered-forced' : 'page-recovered', description: url });
        console.log(`${forced ? 'PAGE-RECOVERED (forced by the test)' : 'PAGE-RECOVERED'} ${url} — ${name}`);
      }
      for (const url of dead) {
        testInfo.annotations.push({ type: forced ? 'page-dead-forced' : 'page-dead', description: url });
        console.log(`${forced ? 'PAGE-DEAD (forced by the test)' : 'PAGE-DEAD'} ${url} — ${name}`);
      }
    },
    { auto: true },
  ],
});
