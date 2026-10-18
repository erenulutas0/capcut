/**
 * Where each language's pages are (ADR-048). Every page exists twice, prerendered:
 *
 *   Turkish            English
 *   /                  /en/
 *   /editor/           /en/editor/
 *   /yap/<id>/         /en/yap/<id>/
 *   /gizlilik/         /gizlilik/en/      (the English privacy page kept its address of 9 Oct 2026)
 *
 * Paths here are WITHOUT the site's base path (`/capcut` on GitHub Pages) unless
 * a function says otherwise: `next/link` adds it by itself.
 *
 * The same mapping is written, in plain browser JavaScript, into the language
 * script of every page (scripts/lib/language-redirect.js); tests/unit/
 * languageRedirect.test.ts runs both over the same table.
 */

import type { Locale } from './translate';

const PRIVACY = '/gizlilik';

/** Splits `/yap/gif?paylasim=x#y` into the path and what follows it. */
function splitPath(path: string): [string, string] {
  const at = path.search(/[?#]/);
  return at === -1 ? [path, ''] : [path.slice(0, at), path.slice(at)];
}

const isSegment = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The language a path (without the base) belongs to. */
export function localeOfPath(path: string): Locale {
  const [bare] = splitPath(path);
  return isSegment(bare, '/en') || isSegment(bare, `${PRIVACY}/en`) ? 'en' : 'tr';
}

/** The Turkish address of an app path in either language: `/en/yap/kes` → `/yap/kes`, `/gizlilik/en/` → `/gizlilik/`. */
export function turkishPath(path: string): string {
  const [bare, rest] = splitPath(path);
  if (isSegment(bare, `${PRIVACY}/en`)) return `${PRIVACY}${bare.slice(`${PRIVACY}/en`.length)}${rest}`;
  if (isSegment(bare, '/en')) return `${bare.slice('/en'.length) || '/'}${rest}`;
  return path;
}

/**
 * The address of a page in `locale`, from its address in either language:
 * `localizedPath('/editor', 'en')` is `/en/editor`, `localizedPath('/', 'en')` is
 * `/en`, `localizedPath('/en/yap/kes/', 'tr')` is `/yap/kes/`. A trailing slash,
 * a query and a hash are kept.
 */
export function localizedPath(path: string, locale: Locale): string {
  const turkish = turkishPath(path);
  if (locale === 'tr') return turkish;
  const [bare, rest] = splitPath(turkish);
  if (isSegment(bare, PRIVACY)) return `${PRIVACY}/en${bare.slice(PRIVACY.length)}${rest}`;
  if (bare === '/' || bare === '') return `/en${rest}`;
  return `/en${bare}${rest}`;
}

/**
 * As `localizedPath`, for a full pathname that starts with the base path (`/capcut/en/editor/`), as
 * the page script computes it (scripts/lib/language-redirect.js). `slash`: the build's folders end
 * in '/' (the static export). Null when the pathname is outside the base.
 */
export function localizedPathname(pathname: string, locale: Locale, base: string, slash: boolean): string | null {
  if (base && pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const inside = pathname.slice(base.length) || '/';
  const bare = inside.length > 1 && inside.endsWith('/') ? inside.slice(0, -1) : inside;
  let target = localizedPath(bare, locale);
  if (slash && !target.endsWith('/')) target = `${target}/`;
  return `${base}${target}`;
}
