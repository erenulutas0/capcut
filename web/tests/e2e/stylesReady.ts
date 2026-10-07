import { expect, type Page, type TestInfo } from '@playwright/test';

/**
 * What an axe audit stands on: the page's stylesheets.
 *
 * On 5 Oct 2026 the opening-screen audit failed once on GitHub Actions with
 * `color-contrast` on 23 nodes in all four states and passed on the rerun.
 * Blocking the page's own stylesheet (home.css) while the shared one
 * (globals.css) loads reproduces that finding node for node — same count,
 * same targets (docs/a11y/2026-09-22-audit.md, "Kararsız test"). So that run
 * audited a page one of whose stylesheets never arrived: not a contrast
 * problem, and nothing an audit can say anything about.
 *
 * `expectStylesApplied` therefore runs before every audit. It waits until
 * every `<link rel="stylesheet">` of the document has a sheet with rules and
 * the design tokens are in effect (a real condition, not a pause). When a
 * sheet does not arrive it FAILS the test — a missing stylesheet is a broken
 * page — but as what it is, with the request's status attached, instead of
 * as two dozen false contrast findings. It does not retry anything and does
 * not relax the audit.
 */

interface SheetState {
  href: string | null;
  /** Rules the browser parsed from it; 0 while loading and when the request failed. */
  rules: number;
  /** HTTP status of the request (0: no response), null when the browser recorded none. */
  status: number | null;
  bytes: number | null;
  ms: number | null;
}

interface StyleState {
  sheets: SheetState[];
  /** `--bg` of globals.css as the page sees it; empty when the tokens are not there. */
  tokenBg: string;
  bodyBg: string;
  url: string;
}

function readStyles(page: Page): Promise<StyleState> {
  return page.evaluate(() => {
    const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) => {
      let rules = 0;
      try {
        rules = link.sheet ? link.sheet.cssRules.length : 0;
      } catch {
        rules = 0;
      }
      const entry = performance.getEntriesByName(link.href, 'resource')[0] as
        | (PerformanceResourceTiming & { responseStatus?: number })
        | undefined;
      return {
        href: link.getAttribute('href'),
        rules,
        status: entry ? (entry.responseStatus ?? null) : null,
        bytes: entry ? entry.decodedBodySize : null,
        ms: entry ? Math.round(entry.duration) : null,
      };
    });
    return {
      sheets,
      tokenBg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      url: window.location.pathname,
    };
  });
}

function problem(state: StyleState): string | null {
  if (state.sheets.length === 0) return 'the page has no stylesheet link';
  const missing = state.sheets.filter((sheet) => sheet.rules === 0);
  if (missing.length > 0) {
    return `stylesheet not applied: ${missing
      .map((sheet) => `${sheet.href} (status ${sheet.status ?? 'unknown'}, ${sheet.bytes ?? '?'} bytes, ${sheet.ms ?? '?'} ms)`)
      .join(', ')}`;
  }
  if (state.tokenBg === '') return 'the design tokens (--bg of globals.css) are not defined';
  if (state.bodyBg === 'rgba(0, 0, 0, 0)') return 'the page background token is not applied to <body>';
  return null;
}

/**
 * Waits (up to 10 s) for the page's stylesheets to be loaded and applied;
 * fails with the evidence when they are not.
 */
export async function expectStylesApplied(page: Page, label: string, testInfo?: TestInfo): Promise<void> {
  const deadline = Date.now() + 10_000;
  let state = await readStyles(page);
  while (problem(state) !== null && Date.now() < deadline) {
    await page.waitForTimeout(100);
    state = await readStyles(page);
  }
  const found = problem(state);
  if (found !== null) {
    // One parsable line, like the audit's own: a CI log is all there is afterwards.
    console.log(`STYLES ${JSON.stringify({ label, problem: found, ...state })}`);
    await testInfo?.attach(`styles-${label}`, { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
  }
  expect(found, `"${label}" (${state.url}) was about to be audited without its styles — ${found}`).toBeNull();
}
