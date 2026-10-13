/**
 * The app's side of the page watchdog (ADR-044).
 *
 * The watchdog itself is not here: it must work on a page where none of the
 * app's code ever ran, so it is a plain inline script, written into every
 * built page as the first thing in `<head>` (scripts/lib/page-watchdog.js,
 * scripts/apply-csp.mjs — which is where what it does, and its limits, are
 * written down). This module holds the names both sides use, and the one
 * thing the living app says to it: "I am alive".
 *
 * tests/unit/pageWatchdog.test.ts checks that the script's configuration
 * carries these same names.
 */

/** sessionStorage: what the tab remembers about its one automatic reload (docs/privacy/DATA_INVENTORY.md §2.4a). */
export const PAGE_RECOVERY_KEY = 'clip:page-recovery';
/** On `<html>`: React has taken the page over. */
export const PAGE_ALIVE_ATTRIBUTE = 'data-clip-alive';
/** On any element: this part still waits for its code; the page is not alive while one is in it. */
export const PAGE_PENDING_ATTRIBUTE = 'data-clip-pending';
/** The prerendered notice (components/PageWatchdog.tsx). */
export const PAGE_NOTICE_ID = 'clip-page-dead';
/** Marks an in-page message about a part that could not be loaded (components/LazyPart.tsx). */
export const CHUNK_ERROR_ATTRIBUTE = 'data-clip-chunk-error';
/** Start of the console line a recovered page writes. */
export const PAGE_RECOVERED_LOG = '[page-recovered]';

/**
 * What the tab remembers about its one automatic reload.
 * - `reloading`: written just before the reload; the next page load reads it.
 * - `retried`: that next load has started; it is the second try.
 * - `recovered`: the second try came alive.
 * `t` is when the reload was made (ms), `p` the page's path, `why` what was
 * seen: `file` (a build script did not load), `style` (a stylesheet did not),
 * `timeout` (not alive 15 s after load), `button` / `reset` (the notice's buttons).
 */
export interface PageRecoveryFlag {
  s: 'reloading' | 'retried' | 'recovered';
  t: number;
  p: string;
  why: string;
}

let everAlive = false;

/** Has this page been alive at any time since it was loaded? (False while it is still starting.) */
export function wasPageAlive(): boolean {
  return everAlive;
}

/**
 * Called by the root layout's effect: React owns the page. Also closes the
 * tab's note about an automatic reload ("the second try came alive"), and
 * says so on the console — the e2e suite and the soak script count those
 * lines, so that a load which healed itself is never a silent one.
 */
export function markPageAlive(): void {
  everAlive = true;
  document.documentElement.setAttribute(PAGE_ALIVE_ATTRIBUTE, '');
  try {
    const raw = window.sessionStorage.getItem(PAGE_RECOVERY_KEY);
    if (!raw) return;
    const flag = JSON.parse(raw) as Partial<PageRecoveryFlag> | null;
    if (flag && flag.s === 'retried') {
      window.sessionStorage.setItem(PAGE_RECOVERY_KEY, JSON.stringify({ ...flag, s: 'recovered' }));
      console.info(`${PAGE_RECOVERED_LOG} ${window.location.pathname}`);
    }
  } catch {
    // sessionStorage cannot be used here: there was no automatic reload either.
  }
}
