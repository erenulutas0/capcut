/**
 * The inline script of scripts/lib/language-redirect.js (ADR-048), made ready
 * for a page: the site's sub-path, the static export's trailing slash, and
 * where it goes in the HTML. Used by scripts/apply-csp.mjs after every build —
 * before the policy is computed, so its hash is in the policy like every other
 * inline script's — and by the unit tests, which run the very text a page gets.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANGUAGE_MARKER = 'data-clip-language';

/** localStorage key of the reader's own choice (docs/privacy/DATA_INVENTORY.md §2.4c). */
export const LANGUAGE_STORAGE_KEY = 'clip.language';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'language-redirect.js');
const BODY_RE = /\/\/ @clip-language-begin\r?\n([\s\S]*?)\r?\n\/\/ @clip-language-end/;
const CONFIG_RE = /\/\* @clip-language-config \*\/[\s\S]*?\/\* @end \*\//;
const SCRIPT_RE = new RegExp(`<script ${LANGUAGE_MARKER}="">[\\s\\S]*?</script>`, 'g');

/**
 * - showAfterMs 4000: the twin is another page of the same site, stored by the
 *   service worker once installed; when it has not replaced this one after 4 s
 *   (a stalled connection on a first visit), this page shows itself rather
 *   than stay blank.
 */
export function languageConfig(base = '', slash = false) {
  return { base, slash, key: LANGUAGE_STORAGE_KEY, showAfterMs: 4000 };
}

/** The script's text for a site under `base`; `slash`: the build's folders end in '/' (the static export). */
export function languageScript(base = '', slash = false, template = readFileSync(TEMPLATE, 'utf8')) {
  const body = BODY_RE.exec(template)?.[1];
  if (!body) throw new Error('language script template: no // @clip-language-begin … // @clip-language-end');
  if (!CONFIG_RE.test(body)) throw new Error('language script template: no /* @clip-language-config */ marker');
  const code = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'))
    .join('\n')
    .replace(CONFIG_RE, () => JSON.stringify(languageConfig(base, slash)));
  if (/<\/script|<!--/i.test(code)) throw new Error('language script template: contains </script or <!--');
  return code;
}

/**
 * True for the pages that have a twin in the other language: every app page,
 * not Next's own (`_not-found`, `_global-error`, the export's `404`).
 * `rel` is the HTML file's path inside the build folder, with '/'.
 */
export function hasTwin(rel) {
  return !rel.split('/').some((part) => part.startsWith('_')) && rel !== '404.html' && !rel.startsWith('404/');
}

/** Writes (or rewrites) the script into one HTML document, right after <meta charset>: before anything else. */
export function insertLanguageScript(html, script) {
  const stripped = html.replace(SCRIPT_RE, '');
  const charset = /<meta charSet="utf-8"\/>|<meta charset="utf-8"\/?>/i.exec(stripped);
  if (!charset) throw new Error('language script: no <meta charset> to put the script after');
  const at = charset.index + charset[0].length;
  return `${stripped.slice(0, at)}<script ${LANGUAGE_MARKER}="">${script}</script>${stripped.slice(at)}`;
}
