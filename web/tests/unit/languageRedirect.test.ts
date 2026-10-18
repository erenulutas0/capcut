import { describe, expect, it } from 'vitest';

import { applyCsp } from '../../scripts/lib/csp.mjs';
import { LANGUAGE_MARKER, LANGUAGE_STORAGE_KEY, hasTwin, insertLanguageScript, languageConfig, languageScript } from '../../scripts/lib/languageScript.mjs';
import { LANGUAGE_STORAGE_KEY as APP_KEY } from '@/adapters/languageChoice';
import { localeOfPath, localizedPath, localizedPathname, turkishPath } from '@/i18n/localePath';

/**
 * ADR-048: every page exists in Turkish and in English, and a script in <head> puts the reader on
 * the one of their language before anything is drawn. These tests run the very text a built page
 * carries (`languageScript`), in a stand-in window.
 */

interface Visit {
  path: string;
  search?: string;
  hash?: string;
  lang: 'tr' | 'en';
  languages?: string[];
  stored?: string | null;
  storage?: 'blocked';
  base?: string;
  slash?: boolean;
}

function visit(options: Visit) {
  const store = new Map<string, string>();
  if (options.stored) store.set(LANGUAGE_STORAGE_KEY, options.stored);
  const attributes = new Map<string, string>([['lang', options.lang]]);
  const timers: Array<() => void> = [];
  const state = { replaced: null as string | null, address: null as string | null };
  const win = {
    location: {
      pathname: options.path,
      search: options.search ?? '',
      hash: options.hash ?? '',
      replace: (url: string) => void (state.replaced = url),
    },
    history: { state: null, replaceState: (_: unknown, __: string, url: string) => void (state.address = url) },
    navigator: { languages: options.languages ?? ['tr-TR'], language: (options.languages ?? ['tr-TR'])[0] },
    setTimeout: (fn: () => void) => timers.push(fn),
    get localStorage() {
      if (options.storage === 'blocked') throw new Error('SecurityError');
      return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      };
    },
  };
  const doc = {
    documentElement: {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    },
  };
  const script = languageScript(options.base ?? '/capcut', options.slash ?? true);
  // The script is an IIFE over (window, document, config): run it with ours.
  new Function('window', 'document', script)(win, doc);
  return { ...state, hidden: attributes.has('hidden'), stored: store.get(LANGUAGE_STORAGE_KEY) ?? null, showAgain: () => timers.forEach((fn) => fn()), attributes };
}

describe('the page script (scripts/lib/language-redirect.js)', () => {
  it('a Turkish browser on a Turkish page: nothing happens, nothing is written', () => {
    const page = visit({ path: '/capcut/', lang: 'tr', languages: ['tr-TR', 'en-US'] });
    expect(page.replaced).toBeNull();
    expect(page.hidden).toBe(false);
    expect(page.stored).toBeNull();
  });

  it('an English browser on a Turkish page: hidden at once, replaced by the English twin, nothing written', () => {
    const page = visit({ path: '/capcut/yap/kes/', lang: 'tr', languages: ['en-US', 'en'] });
    expect(page.hidden).toBe(true);
    expect(page.replaced).toBe('/capcut/en/yap/kes/');
    expect(page.stored).toBeNull();
  });

  it('keeps the query and the hash: the share target’s /?paylasim=… lands on the English start screen with the video', () => {
    const page = visit({ path: '/capcut/', search: '?paylasim=abc123', hash: '#x', lang: 'tr', languages: ['en-GB'] });
    expect(page.replaced).toBe('/capcut/en/?paylasim=abc123#x');
  });

  it('the first of the browser’s languages that is Turkish or English decides; neither listed → English', () => {
    expect(visit({ path: '/capcut/', lang: 'tr', languages: ['de-DE', 'tr', 'en'] }).replaced).toBeNull();
    expect(visit({ path: '/capcut/', lang: 'tr', languages: ['de-DE', 'en', 'tr'] }).replaced).toBe('/capcut/en/');
    expect(visit({ path: '/capcut/', lang: 'tr', languages: ['de-DE', 'fr'] }).replaced).toBe('/capcut/en/');
    expect(visit({ path: '/capcut/en/', lang: 'en', languages: ['az', 'tr-TR'] }).replaced).toBe('/capcut/');
    // A browser that says nothing: the page stays as it was asked for.
    expect(visit({ path: '/capcut/', lang: 'tr', languages: [] }).replaced).toBeNull();
  });

  it('a remembered choice wins over the browser', () => {
    expect(visit({ path: '/capcut/', lang: 'tr', languages: ['en-US'], stored: 'tr' }).replaced).toBeNull();
    expect(visit({ path: '/capcut/editor/', lang: 'tr', languages: ['tr-TR'], stored: 'en' }).replaced).toBe('/capcut/en/editor/');
    expect(visit({ path: '/capcut/en/yap/gif/', lang: 'en', languages: ['en-US'], stored: 'tr' }).replaced).toBe('/capcut/yap/gif/');
    // Anything else in the key is not a choice.
    expect(visit({ path: '/capcut/', lang: 'tr', languages: ['tr-TR'], stored: 'de' }).replaced).toBeNull();
  });

  it('?lang= (the language button): remembered, taken off the address, and no second jump', () => {
    const page = visit({ path: '/capcut/en/', search: '?lang=en&paylasim=abc', lang: 'en', languages: ['tr-TR'] });
    expect(page.stored).toBe('en');
    expect(page.address).toBe('/capcut/en/?paylasim=abc');
    expect(page.replaced).toBeNull();
    const last = visit({ path: '/capcut/gizlilik/', search: '?x=1&lang=tr', lang: 'tr', languages: ['en-US'] });
    expect(last.stored).toBe('tr');
    expect(last.address).toBe('/capcut/gizlilik/?x=1');
    expect(last.replaced).toBeNull();
    // An address that asks for the other language than its page's: there it goes, choice remembered.
    const other = visit({ path: '/capcut/', search: '?lang=en', lang: 'tr', languages: ['tr-TR'] });
    expect(other.stored).toBe('en');
    expect(other.replaced).toBe('/capcut/en/');
  });

  it('where storage cannot be used, the browser’s language still decides and nothing throws', () => {
    expect(visit({ path: '/capcut/', lang: 'tr', languages: ['en-US'], storage: 'blocked' }).replaced).toBe('/capcut/en/');
    expect(visit({ path: '/capcut/en/', search: '?lang=en', lang: 'en', languages: ['tr'], storage: 'blocked' }).replaced).toBeNull();
  });

  it('the hidden page shows itself again if its twin does not come', () => {
    const page = visit({ path: '/capcut/', lang: 'tr', languages: ['en-US'] });
    expect(page.hidden).toBe(true);
    page.showAgain();
    expect(page.attributes.has('hidden')).toBe(false);
  });

  it('the privacy pages are each other’s twins; addresses outside the site are left alone', () => {
    expect(visit({ path: '/capcut/gizlilik/', lang: 'tr', languages: ['en'] }).replaced).toBe('/capcut/gizlilik/en/');
    expect(visit({ path: '/capcut/gizlilik/en/', lang: 'en', languages: ['tr'] }).replaced).toBe('/capcut/gizlilik/');
    expect(visit({ path: '/other/', lang: 'tr', languages: ['en'] }).replaced).toBeNull();
  });

  it('a server without trailing slashes (next start, the e2e build) and no base path', () => {
    expect(visit({ path: '/', lang: 'tr', languages: ['en'], base: '', slash: false }).replaced).toBe('/en');
    expect(visit({ path: '/en', lang: 'en', languages: ['tr'], base: '', slash: false }).replaced).toBe('/');
    expect(visit({ path: '/yap/kes', lang: 'tr', languages: ['en'], base: '', slash: false }).replaced).toBe('/en/yap/kes');
    expect(visit({ path: '/en/editor', lang: 'en', languages: ['tr'], base: '', slash: false }).replaced).toBe('/editor');
  });

  it('is the app’s own key, and sits first in <head>, hashed into the policy', () => {
    expect(LANGUAGE_STORAGE_KEY).toBe(APP_KEY);
    expect(languageConfig('/capcut', true)).toEqual({ base: '/capcut', slash: true, key: 'clip.language', showAfterMs: 4000 });
    const page = '<!DOCTYPE html><html lang="tr"><head><meta charSet="utf-8"/><link rel="stylesheet" href="/a.css"/></head><body></body></html>';
    const { html, policy } = applyCsp(insertLanguageScript(page, languageScript('/capcut', true)));
    expect(html.indexOf(LANGUAGE_MARKER)).toBeLessThan(html.indexOf('/a.css'));
    expect(policy.match(/'sha256-/g)?.length).toBe(1);
    // Written twice, it is there once.
    expect(insertLanguageScript(insertLanguageScript(page, 'a'), 'b').match(new RegExp(LANGUAGE_MARKER, 'g'))?.length).toBe(1);
  });

  it('goes into every app page, not into Next’s own', () => {
    for (const rel of ['index.html', 'en/index.html', 'yap/kes/index.html', 'editor.html', 'en/yap/kes.html', 'gizlilik/en.html']) expect(hasTwin(rel), rel).toBe(true);
    for (const rel of ['404.html', '_not-found.html', '_not-found/index.html', '_global-error.html', '404/index.html']) expect(hasTwin(rel), rel).toBe(false);
  });
});

describe('the address table (src/i18n/localePath.ts): the same as the script', () => {
  const TABLE: Array<[string, string]> = [
    ['/', '/en'],
    ['/editor', '/en/editor'],
    ['/yap/kes', '/en/yap/kes'],
    ['/yap/kes/', '/en/yap/kes/'],
    ['/gizlilik', '/gizlilik/en'],
    ['/gizlilik/', '/gizlilik/en/'],
    ['/yap/gif?paylasim=x', '/en/yap/gif?paylasim=x'],
  ];

  it('Turkish ↔ English, both ways', () => {
    for (const [turkish, english] of TABLE) {
      expect(localizedPath(turkish, 'en'), turkish).toBe(english);
      expect(localizedPath(english, 'tr'), english).toBe(turkish);
      expect(localizedPath(english, 'en'), english).toBe(english);
      expect(localizedPath(turkish, 'tr'), turkish).toBe(turkish);
      expect(localeOfPath(turkish)).toBe('tr');
      expect(localeOfPath(english)).toBe('en');
      expect(turkishPath(english)).toBe(turkish);
    }
    // A Turkish word that starts like the English prefix is not English.
    expect(localeOfPath('/editor')).toBe('tr');
    expect(localeOfPath('/english')).toBe('tr');
  });

  it('full pathnames agree with the script', () => {
    for (const path of ['/capcut/', '/capcut/editor/', '/capcut/yap/kes/', '/capcut/gizlilik/', '/capcut/en/', '/capcut/en/yap/gif/', '/capcut/gizlilik/en/']) {
      for (const locale of ['tr', 'en'] as const) {
        const page = visit({ path, lang: localeOfPath(path.slice('/capcut'.length)) === 'en' ? 'en' : 'tr', languages: [locale] });
        const expected = localizedPathname(path, locale, '/capcut', true);
        expect(page.replaced ?? path, `${path} → ${locale}`).toBe(expected);
      }
    }
    expect(localizedPathname('/elsewhere/', 'en', '/capcut', true)).toBeNull();
  });
});
