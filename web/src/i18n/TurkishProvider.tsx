'use client';

import type { ReactNode } from 'react';

// Loading this module is the point: it registers Turkish with `translator('tr')` in this page.
import './messages';
import { LocaleProvider } from './locale';

/**
 * The root of a Turkish page (ADR-048): its words, and the language every component under it speaks.
 * The English pages use `EnglishProvider` and never load the Turkish table.
 */
export function TurkishProvider({ children }: { children: ReactNode }) {
  return <LocaleProvider locale="tr">{children}</LocaleProvider>;
}
