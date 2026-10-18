'use client';

import { usePathname } from 'next/navigation';

import { LANGUAGE_PARAM, rememberLanguage } from '@/adapters/languageChoice';
import { BASE_PATH } from '@/basePath';
import { useLocale } from '@/i18n/locale';
import { localizedPath, localizedPathname } from '@/i18n/localePath';
import type { Locale } from '@/i18n/translate';

const SLASH = process.env.NEXT_PUBLIC_TRAILING_SLASH === '1';

/** The other language's name, written in that language: what a reader of it looks for. */
const NAME: Record<Locale, string> = { tr: 'Türkçe', en: 'English' };

/** The same page in `locale`, with the word that makes the choice remembered (`?lang=en`). */
function addressIn(locale: Locale, pathname: string): string {
  const path = localizedPath(pathname, locale);
  const full = `${BASE_PATH}${path}`;
  return `${SLASH && !full.endsWith('/') ? `${full}/` : full}?${LANGUAGE_PARAM}=${locale}`;
}

/** The current address, in `locale`: same page, same query (a shared video's `paylasim=…`), the choice added. */
function currentAddressIn(locale: Locale): string {
  const { pathname, search, hash } = window.location;
  const target = localizedPathname(pathname, locale, BASE_PATH, SLASH) ?? `${BASE_PATH}/`;
  const query = new URLSearchParams(search);
  query.set(LANGUAGE_PARAM, locale);
  return `${target}?${query.toString()}${hash}`;
}

/**
 * "English" on a Turkish page, "Türkçe" on an English one (ADR-048): the same
 * page in the other language. A plain link to the other page's prerendered
 * address — it works before the page is alive, and without script — carrying
 * `?lang=…`, which the page script remembers (localStorage `clip.language`)
 * and takes off the address. Once the page is alive a press keeps the
 * address's query too. Moving to the other language is a full page load: what
 * is open only in this tab (a video not yet saved in a project) is not carried.
 */
export function LanguageSwitch({ className = 'language-switch', testId = 'language-switch' }: { className?: string; testId?: string }) {
  const locale = useLocale();
  const other: Locale = locale === 'tr' ? 'en' : 'tr';
  const pathname = usePathname() ?? '/';
  return (
    <a
      className={className}
      href={addressIn(other, pathname)}
      hrefLang={other}
      lang={other}
      data-testid={testId}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        rememberLanguage(other);
        window.location.assign(currentAddressIn(other));
      }}
    >
      {NAME[other]}
    </a>
  );
}
