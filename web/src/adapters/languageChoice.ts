/**
 * The reader's own language choice (ADR-048): one localStorage key, written
 * only when the language button is used (or an address that carries
 * `lang=tr|en`, which is what that button opens). Read by the language script
 * in every page's <head> (scripts/lib/language-redirect.js) before anything is
 * drawn. Listed in docs/privacy/DATA_INVENTORY.md §2.4c and on /gizlilik.
 * Never sent anywhere.
 */
import type { Locale } from '@/i18n/translate';

/** The same key the page script reads (scripts/lib/languageScript.mjs `LANGUAGE_STORAGE_KEY`). */
export const LANGUAGE_STORAGE_KEY = 'clip.language';

/** The address word the language button adds; the page script remembers it and takes it off. */
export const LANGUAGE_PARAM = 'lang';

export function rememberedLanguage(): Locale | null {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return value === 'tr' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

export function rememberLanguage(locale: Locale): boolean {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

export function forgetLanguage(): boolean {
  try {
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
