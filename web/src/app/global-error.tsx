'use client';

import { useEffect } from 'react';

import { APP_NAME } from '@/appIdentity';
import { BASE_PATH } from '@/basePath';
import { localeOfPath } from '@/i18n/localePath';
import { PageCrash } from '@/components/PageCrash';
import { markPageAlive } from '@/pageWatchdog';

import './globals.css';

/**
 * The root layout itself stopped with an error: this replaces the whole
 * document (components/PageCrash.tsx, ADR-044). The user has been told, so
 * the page counts as alive for the watchdog — unless the cause is a part
 * that did not arrive, which `PageCrash` marks as still waiting.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    markPageAlive();
  }, []);
  // Outside both root layouts (ADR-048): the address says which language the page spoke.
  const lang = typeof window !== 'undefined' ? localeOfPath(window.location.pathname.slice(BASE_PATH.length) || '/') : 'tr';
  return (
    <html lang={lang}>
      <head>
        <title>{APP_NAME}</title>
      </head>
      <body>
        <PageCrash error={error} />
      </body>
    </html>
  );
}
