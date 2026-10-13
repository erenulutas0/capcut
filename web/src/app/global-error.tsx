'use client';

import { useEffect } from 'react';

import { APP_NAME } from '@/appIdentity';
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
  return (
    <html lang="tr">
      <head>
        <title>{APP_NAME}</title>
      </head>
      <body>
        <PageCrash error={error} />
      </body>
    </html>
  );
}
