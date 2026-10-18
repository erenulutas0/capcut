import type { Metadata } from 'next';

import { withBasePath } from '@/basePath';

import { localizedPath } from './localePath';

/** '1' where every page is a folder (the static export): addresses end in '/'. */
const SLASH = process.env.NEXT_PUBLIC_TRAILING_SLASH === '1';

function address(path: string): string {
  const full = withBasePath(path);
  return SLASH && !full.endsWith('/') ? `${full}/` : full;
}

/**
 * `<link rel="alternate" hreflang>` for a page and its twin (ADR-048): search engines and
 * browsers learn that `/yap/kes/` and `/en/yap/kes/` are the same page in two languages.
 * Written with the base path (until 18 Oct 2026 the privacy page's links lacked `/capcut`).
 */
export function languageAlternates(turkishPath: string): NonNullable<Metadata['alternates']> {
  return {
    languages: {
      tr: address(localizedPath(turkishPath, 'tr')),
      en: address(localizedPath(turkishPath, 'en')),
    },
  };
}
