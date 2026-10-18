'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { CloudMessageKey } from './cloudMessages';
import { cloudTranslator } from './cloudTranslate';
import { localizedPath } from './localePath';
import { translator, type Locale, type Translate } from './translate';

/**
 * The language of the page (ADR-048), for every component under the root layout.
 * Set by `TurkishProvider` / `EnglishProvider` (which also bring that language's
 * words); Turkish when nothing set it.
 */
const LocaleContext = createContext<Locale>('tr');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** The words of the page's language. */
export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}

/**
 * The words of the cloud transcript route in the page's language. Only that route's own chunk uses
 * it, and it brings its language's table with it (components/wizard/YaziWizard.tsx).
 */
export function useCloudT(): (key: CloudMessageKey) => string {
  const locale = useLocale();
  return useMemo(() => cloudTranslator(locale), [locale]);
}

/** `/editor` → `/en/editor` on an English page; unchanged on a Turkish one. For `next/link` (it adds the base path). */
export function useLocalePath(): (path: string) => string {
  const locale = useLocale();
  return useMemo(() => (path: string) => localizedPath(path, locale), [locale]);
}
