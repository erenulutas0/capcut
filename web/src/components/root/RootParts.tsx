import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { APP_NAME, APP_THEME, pageTitle } from '@/appIdentity';
import { PageAlive } from '@/components/PageAlive';
import { PageWatchdogNotice } from '@/components/PageWatchdog';
import { PwaClient } from '@/components/pwa/PwaClient';
import { translator, type Locale } from '@/i18n/translate';

/**
 * What both root layouts share (ADR-048): the Turkish pages (`app/(tr)/layout.tsx`, `<html lang="tr">`)
 * and the English ones (`app/(en)/layout.tsx`, `<html lang="en">`) are two root layouts, so that every
 * page is prerendered in its own language with the right `lang` — and moving between them is a full
 * page load, which is what the language button does anyway.
 */
export function rootMetadata(locale: Locale): Metadata {
  const t = translator(locale);
  return {
    title: pageTitle(t('meta.home.title')),
    description: t('meta.description'),
    // Links out (GitHub Issues, the host's privacy statement) carry no
    // Referer: the page address is nobody else's business. Nothing on the
    // site's own origin reads it. The Content-Security-Policy is not here but
    // written after the build (scripts/apply-csp.mjs, which explains why).
    referrer: 'no-referrer',
    // Installed app (ADR-031): the manifest comes from app/manifest.ts, the
    // home-screen icon for iOS from app/apple-icon.png.
    applicationName: APP_NAME,
    appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'black' },
  };
}

export const rootViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: APP_THEME,
};

/**
 * The body of every page. `provider` is the language's own (TurkishProvider / EnglishProvider): it
 * brings that language's words and tells the components which language they speak.
 */
export function RootBody({ provider: Provider, children }: { provider: (props: { children: ReactNode }) => ReactNode; children: ReactNode }) {
  return (
    <body>
      <Provider>
        {children}
        <PwaClient />
      </Provider>
      {/*
        A page that never comes alive says so and reloads once (ADR-044). The script that watches is
        written into <head> after the build (scripts/apply-csp.mjs); here are the sign that React has
        taken the page over, and the notice the script shows when it has not (in both languages: the
        script shows the one of <html lang>).
      */}
      <PageAlive />
      <PageWatchdogNotice />
    </body>
  );
}
