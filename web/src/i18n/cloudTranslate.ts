/**
 * Looking up the words of the cloud transcript route (ADR-039, ADR-048). No words
 * here: `cloudMessages.ts` (Turkish) and `cloudMessages.en.ts` (English) add
 * themselves when they are loaded, and a page loads only its own language's
 * (src/components/transcript/cloudWords.ts). Components import from HERE, never a
 * value from `cloudMessages.ts`.
 */

import type { CloudMessageKey } from './cloudMessages';
import type { Locale } from './translate';

/**
 * The provider's own pages the privacy page links to: the ones ADR-039 quotes (read 10 Oct 2026) for
 * retention, model training and the data processing addendum. Not fetched by the app; plain links.
 */
export const PROVIDER_PAGES = {
  retention: 'https://www.assemblyai.com/docs/data-retention-and-model-training',
  dpa: 'https://www.assemblyai.com/legal/data-processing-addendum',
} as const;

const dictionaries: Partial<Record<Locale, Record<CloudMessageKey, string>>> = {};

/** Makes a language available (called by `cloudMessages.ts` and `cloudMessages.en.ts`). */
export function registerCloudMessages(locale: Locale, dictionary: Record<CloudMessageKey, string>): void {
  dictionaries[locale] = dictionary;
}

export function cloudTranslator(locale: Locale = 'tr') {
  return (key: CloudMessageKey): string => {
    const dictionary = dictionaries[locale] ?? dictionaries.tr ?? dictionaries.en;
    return dictionary ? dictionary[key] : key;
  };
}
