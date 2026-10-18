/**
 * The inline script of scripts/lib/page-watchdog.js (ADR-044), made ready for
 * a page: its limits, the site's sub-path, and where it goes in the HTML.
 * Used by scripts/apply-csp.mjs after every build — before the policy is
 * computed, so the script's hash is in the policy like every other inline
 * script's — and by the unit tests, which run the very text a page gets.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WATCHDOG_MARKER = 'data-clip-watchdog';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'page-watchdog.js');
const BODY_RE = /\/\/ @clip-watchdog-begin\r?\n([\s\S]*?)\r?\n\/\/ @clip-watchdog-end/;
const CONFIG_RE = /\/\* @clip-watchdog-config \*\/[\s\S]*?\/\* @end \*\//;
const SCRIPT_RE = new RegExp(`<script ${WATCHDOG_MARKER}="">[\\s\\S]*?</script>`, 'g');

/**
 * The limits, and where they come from (ADR-044, scripts/soak/hydration-soak.mjs):
 * from the start of the navigation, hydration took 0.3–0.8 s (median) on an
 * idle machine and 6.5 s at the 99th percentile with 16 pages loading at once
 * and 10 processes burning CPU.
 * - graceS 15: counted from `load`, not from the start; more than twice that
 *   worst measured figure. A false alarm costs one reload of a page on which
 *   nothing could have been done yet.
 * - errorS 4: after a build file failed. The bundler asks for it again
 *   200–600 ms later; then the file and hydration have over three seconds.
 * - stuckS 45: without `load`. Only the notice, no reload, so a merely slow
 *   connection loses nothing; the whole app is under 1 MB of script.
 * - quietMs 5 min: no second automatic reload in the tab within that time.
 */
export function watchdogConfig(base = '') {
  return {
    key: 'clip:page-recovery',
    aliveAttr: 'data-clip-alive',
    pendingAttr: 'data-clip-pending',
    noticeId: 'clip-page-dead',
    // Only the app's own build files count.
    staticPrefix: `${base}/_next/static/`,
    // The service worker's scope.
    scope: `${base}/`,
    // The app-shell caches ("clip-app-<version>"); the speech model's cache is not one of them.
    cachePrefix: 'clip-app-',
    graceS: 15,
    errorS: 4,
    stuckS: 45,
    quietMs: 5 * 60 * 1000,
  };
}

/** The script's text for a site under `base` ('' or '/capcut'): the template's code, comment lines and indentation removed. */
export function watchdogScript(base = '', template = readFileSync(TEMPLATE, 'utf8')) {
  const body = BODY_RE.exec(template)?.[1];
  if (!body) throw new Error('page watchdog template: no // @clip-watchdog-begin … // @clip-watchdog-end');
  if (!CONFIG_RE.test(body)) throw new Error('page watchdog template: no /* @clip-watchdog-config */ marker');
  const code = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'))
    .join('\n')
    .replace(CONFIG_RE, () => JSON.stringify(watchdogConfig(base)));
  // Inside <script> only these two could end or confuse the element.
  if (/<\/script|<!--/i.test(code)) throw new Error('page watchdog template: contains </script or <!--');
  return code;
}

/**
 * Writes (or rewrites) the script into one HTML document: right after
 * <meta charset>, so it runs before any stylesheet or script of the page is
 * asked for. The policy tag (scripts/lib/csp.mjs) is then written between
 * the two, and governs it.
 */
export function insertWatchdog(html, script) {
  const stripped = html.replace(SCRIPT_RE, '');
  const charset = /<meta charSet="utf-8"\/>|<meta charset="utf-8"\/?>/i.exec(stripped);
  if (!charset) throw new Error('page watchdog: no <meta charset> to put the script after');
  const at = charset.index + charset[0].length;
  return `${stripped.slice(0, at)}<script ${WATCHDOG_MARKER}="">${script}</script>${stripped.slice(at)}`;
}
