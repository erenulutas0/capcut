/**
 * Looking words up (ADR-048). This module holds NO words: each language's table
 * lives in a module of its own (`messages.ts` Turkish, `messages.en.ts` English)
 * that adds itself here when it is loaded. A page loads the table of the language
 * it speaks — the Turkish pages `messages.ts`, the English pages (`/en/…`,
 * `/gizlilik/en`) `messages.en.ts` (src/i18n/LanguageProvider.tsx) — so a page
 * carries one language's words, not both.
 *
 * Components must import `translator` from HERE (or use `useT()`), never a value
 * from `messages.ts`: that would put the Turkish table into every English page
 * (tests/unit/i18nCoverage.test.ts watches the imports).
 */

import type { MessageKey } from './messages';

export type Locale = 'tr' | 'en';

export const LOCALES: readonly Locale[] = ['tr', 'en'];

const dictionaries: Partial<Record<Locale, Record<MessageKey, string>>> = {};

/** Makes a language available to `translator` (called by the language's own module). */
export function registerMessages(locale: Locale, dictionary: Record<MessageKey, string>): void {
  dictionaries[locale] = dictionary;
}

/** True when the words of `locale` are loaded in this page (tests; the provider's own check). */
export function hasMessages(locale: Locale): boolean {
  return dictionaries[locale] !== undefined;
}

/**
 * The words of `locale`. Looked up at the moment of use, so a language that
 * arrives after this was called is used from then on. A language that is not
 * loaded reads in the one that is (Turkish first) rather than not at all.
 */
export function translator(locale: Locale = 'tr') {
  return (key: MessageKey): string => {
    const dictionary = dictionaries[locale] ?? dictionaries.tr ?? dictionaries.en;
    return dictionary ? dictionary[key] : key;
  };
}

export type Translate = ReturnType<typeof translator>;
