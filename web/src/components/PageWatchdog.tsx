import { translator, type Locale } from '@/i18n/messages';
// On the server only (this is not a client component): the notice is written in both languages into the
// page's HTML, and the script shows the one the page speaks. No page's script grows by it.
import '@/i18n/messages.en';
import { PAGE_NOTICE_ID } from '@/pageWatchdog';

function Panel({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <div
      className="update-notice page-dead-panel"
      data-clip-lang={locale}
      lang={locale}
      hidden
      suppressHydrationWarning
    >
      <p className="update-notice-text page-dead-text">
        <b data-clip-when="dead" suppressHydrationWarning>
          {t('page.dead.title')}
        </b>
        <b data-clip-when="late" hidden suppressHydrationWarning>
          {t('page.late.title')}
        </b>
        <span>{t('page.dead.note')}</span>
        <span data-clip-when="late" hidden suppressHydrationWarning>
          {t('page.late.note')}
        </span>
        <span data-clip-when="reset" hidden suppressHydrationWarning>
          {t('page.dead.resetNote')}
        </span>
      </p>
      <div className="update-notice-actions page-dead-actions">
        <button type="button" className="update-notice-button update-notice-primary" data-clip-do="reload" data-testid={`page-dead-reload-${locale}`}>
          {t('page.dead.reload')}
        </button>
        <button
          type="button"
          className="update-notice-button"
          data-clip-do="reset"
          data-clip-when="reset"
          data-testid={`page-dead-reset-${locale}`}
          hidden
          suppressHydrationWarning
        >
          {t('page.dead.reset')}
        </button>
        <button
          type="button"
          className="update-notice-button"
          data-clip-do="close"
          data-clip-when="late"
          data-testid={`page-dead-close-${locale}`}
          hidden
          suppressHydrationWarning
        >
          {t('page.dead.close')}
        </button>
      </div>
    </div>
  );
}

/**
 * The notice the page watchdog shows (ADR-044; the script itself is written into
 * the page after the build, scripts/lib/page-watchdog.js): plain prerendered
 * HTML, in both languages, hidden until it is needed. It is an alert region that is always in the
 * page and empty to the eye; showing a panel inside it is what a screen
 * reader announces. Nothing here needs React to be running.
 */
export function PageWatchdogNotice() {
  return (
    <div id={PAGE_NOTICE_ID} className="page-dead" role="alert" data-state="hidden" data-testid="page-dead" suppressHydrationWarning>
      <Panel locale="tr" />
      <Panel locale="en" />
    </div>
  );
}
