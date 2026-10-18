'use client';

import { useEffect, useRef, useState } from 'react';

import { BASE_PATH } from '@/basePath';
import { useLocale } from '@/i18n/locale';
import { localeOfPath } from '@/i18n/localePath';
import { translator } from '@/i18n/translate';
import { PAGE_PENDING_ATTRIBUTE, wasPageAlive } from '@/pageWatchdog';

/**
 * The app's own word when a page stops with an error nobody caught
 * (app/error.tsx, app/global-error.tsx; ADR-044) — in place of the
 * framework's "Application error: a client-side exception has occurred",
 * which is English, says nothing a child can act on and has no button.
 *
 * A part of the page that could not be fetched (`ChunkLoadError`: the two
 * wizards that bring their own screen, reached from the opening screen over
 * a connection that dropped) gets the sentence about the connection. When
 * that happens while the page is still starting (it has never been alive:
 * nothing can have been done on it), it is also marked as "still waiting for
 * its code", so the page's watchdog makes its one automatic reload exactly
 * as for any other file that did not arrive. On a page that has been alive
 * nothing is marked and nothing reloads by itself.
 *
 * "Yeniden yükle" loads the page again: asking React to draw the same tree
 * again cannot work, a part that failed to load stays failed for the page.
 * The error's own text is shown nowhere.
 */
export function PageCrash({ error }: { error: unknown }) {
  const part = (error as { name?: unknown } | null)?.name === 'ChunkLoadError';
  // The page's language (ADR-048). The address says it even where the root layout itself stopped
  // (app/global-error.tsx, outside the language's provider).
  const context = useLocale();
  const locale = typeof window !== 'undefined' ? localeOfPath(window.location.pathname.slice(BASE_PATH.length) || '/') : context;
  const t = translator(locale);
  // Decided once, when the screen first appears: the layout's own "alive" effect runs after it.
  const [starting] = useState(() => !wasPageAlive());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main className="page-crash" data-testid="page-crash" data-part={part} {...(part && starting ? { [PAGE_PENDING_ATTRIBUTE]: '' } : {})}>
      <div className="page-crash-words" role="alert">
        <h1 ref={heading} tabIndex={-1}>
          {t('crash.title')}
        </h1>
        <p>{t(part ? 'crash.partNote' : 'crash.note')}</p>
      </div>
      <button type="button" className="update-notice-button update-notice-primary" onClick={() => window.location.reload()} data-testid="page-crash-reload">
        {t('crash.reload')}
      </button>
    </main>
  );
}
