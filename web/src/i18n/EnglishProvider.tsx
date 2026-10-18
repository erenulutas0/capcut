'use client';

import type { ReactNode } from 'react';

// Loading this module is the point: it registers English with `translator('en')` in this page.
import './messages.en';
import { LocaleProvider } from './locale';

/**
 * The root of an English page (`/en/…`, `/gizlilik/en`; ADR-048): its words, and the language every
 * component under it speaks. These pages never load the Turkish table (`messages.ts`).
 */
export function EnglishProvider({ children }: { children: ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
