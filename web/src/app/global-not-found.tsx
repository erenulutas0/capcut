import type { Metadata } from 'next';

import { APP_NAME, APP_THEME } from '@/appIdentity';
import { PageAlive } from '@/components/PageAlive';
import { PageWatchdogNotice } from '@/components/PageWatchdog';
import { withBasePath } from '@/basePath';
// On the server only: the page is plain HTML in both languages.
import '@/i18n/messages';
import '@/i18n/messages.en';
import { translator } from '@/i18n/translate';

import './globals.css';

export const metadata: Metadata = {
  title: `404 — ${APP_NAME}`,
  referrer: 'no-referrer',
};

export const viewport = { themeColor: APP_THEME };

const tr = translator('tr');
const en = translator('en');

/**
 * An address that is no page of the app (ADR-048). The app has two root layouts —
 * the Turkish pages and the English ones — so no single layout can draw this; the
 * address does not say which language its reader speaks either, so the page says
 * it in both, each with the way home in that language. It counts as alive for the
 * page watchdog (ADR-044) like every other page.
 */
export default function GlobalNotFound() {
  return (
    <html lang="tr">
      <body>
        <main className="page-crash" data-testid="not-found">
          <div className="page-crash-words">
            <h1>{tr('notFound.title')}</h1>
            <p>
              <a href={withBasePath('/')}>{tr('notFound.home')}</a>
            </p>
          </div>
          <div className="page-crash-words" lang="en">
            <h2>{en('notFound.title')}</h2>
            <p>
              <a href={withBasePath('/en/')}>{en('notFound.home')}</a>
            </p>
          </div>
        </main>
        <PageAlive />
        <PageWatchdogNotice />
      </body>
    </html>
  );
}
