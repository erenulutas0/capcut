'use client';

import { useCallback, useEffect, useState } from 'react';

import { exportLog } from '@/adapters/exportLogStore';
import type { ExportLogEntry } from '@/domain/exportLog';
import { formatTimecode } from '@/domain/time';
import { translator, type Locale, type MessageKey } from '@/i18n/messages';

type LogState =
  | { status: 'loading' }
  | { status: 'ready'; entries: ExportLogEntry[] }
  | { status: 'unavailable' };

function attemptTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return date.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The local export log with its "Günlüğü temizle" action. Used on the privacy
 * page (so the promise "you can delete it" is kept where it is made) and in
 * the report dialog (so the user sees what the file will carry).
 *
 * Takes a locale rather than a `t` function because the privacy page is a
 * server component and cannot hand a function to a client component.
 */
export function ExportLogPanel({
  locale,
  buttonClassName,
  onChanged,
}: {
  locale: Locale;
  buttonClassName: string;
  /** Called after a clear, so a caller showing a preview can rebuild it. */
  onChanged?: () => void;
}) {
  const t = translator(locale);
  const [log, setLog] = useState<LogState>({ status: 'loading' });
  const [message, setMessage] = useState<MessageKey | null>(null);

  const reload = useCallback(async () => {
    try {
      const entries = await exportLog().read();
      setLog({ status: 'ready', entries });
    } catch {
      setLog({ status: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void exportLog()
      .read()
      .then((entries) => {
        if (!cancelled) setLog({ status: 'ready', entries });
      })
      .catch(() => {
        if (!cancelled) setLog({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clear = async () => {
    const ok = await exportLog().clear();
    setMessage(ok ? 'support.log.cleared' : 'support.log.clearFailed');
    await reload();
    onChanged?.();
  };

  const entries = log.status === 'ready' ? log.entries : [];
  const canClear = log.status === 'ready' && entries.length > 0;

  return (
    <div className="export-log" data-testid="export-log">
      {log.status === 'loading' ? <p className="export-log-note">{t('privacy.controls.loading')}</p> : null}
      {log.status === 'unavailable' ? (
        <p className="export-log-note">{t('privacy.controls.unavailable')}</p>
      ) : null}
      {log.status === 'ready' ? (
        <p className="export-log-note" data-testid="export-log-count" data-count={entries.length}>
          {entries.length === 0
            ? t('support.log.empty')
            : t('support.log.count').replace('{count}', String(entries.length))}
        </p>
      ) : null}

      {entries.length > 0 ? (
        <ol className="export-log-list">
          {/* Newest first: the attempt the user is asking about is on top. */}
          {[...entries].reverse().map((entry, index) => (
            <li key={`${entry.at}-${index}`} data-testid="export-log-entry" data-outcome={entry.outcome}>
              <span>{attemptTime(entry.at, locale)}</span>
              <span>{t(`diag.outcome.${entry.outcome}` as MessageKey)}</span>
              {entry.failureCode ? <code>{entry.failureCode}</code> : null}
              <span>{formatTimecode(entry.outputDurationMs * 1000)}</span>
              <span>
                {entry.width}×{entry.height}
              </span>
              {entry.route ? <span>{t(`diag.route.${entry.route}` as MessageKey)}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      <button
        type="button"
        className={buttonClassName}
        onClick={() => {
          if (!canClear) return;
          void clear();
        }}
        // aria-disabled rather than disabled: disabling the button the user
        // just pressed would drop keyboard focus to the page body.
        aria-disabled={!canClear}
        data-testid="export-log-clear"
      >
        {t('support.log.clear')}
      </button>
      <p className="export-log-note" role="status" data-testid="export-log-message">
        {message ? t(message) : ''}
      </p>
    </div>
  );
}
