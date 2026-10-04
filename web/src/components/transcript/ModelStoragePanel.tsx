'use client';

import { useEffect, useState } from 'react';

import { deleteStoredModels, storedModelBytes } from '@/adapters/transcript/modelStore';
import { formatBytes } from '@/domain/policy';
import { translator, type Locale } from '@/i18n/messages';

/**
 * What the speech model occupies in this browser, and "Modeli sil"
 * (ADR-036). Shown where the promise "you can delete it" is made — the
 * privacy page — and in the editor's "Kısayollar ve sınırlar" window.
 *
 * Takes a locale rather than a `t` function: the privacy page is a server
 * component and cannot hand a function to a client component.
 */
export function ModelStoragePanel({ locale, buttonClassName }: { locale: Locale; buttonClassName: string }) {
  const t = translator(locale);
  const [bytes, setBytes] = useState<number | null>(null);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    let live = true;
    void storedModelBytes().then(
      (value) => {
        if (live) setBytes(value);
      },
      () => {
        if (live) setBytes(0);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const remove = async () => {
    await deleteStoredModels().catch(() => undefined);
    const left = await storedModelBytes().catch(() => 0);
    setBytes(left);
    setDeleted(left === 0);
  };

  const has = bytes !== null && bytes > 0;
  return (
    <div className="help-model" data-testid="model-storage" data-bytes={bytes ?? ''}>
      <p className="export-log-note" data-testid="model-storage-size">
        {bytes === null
          ? t('privacy.model.checking')
          : has
            ? t('help.model.stored').replace('{size}', formatBytes(bytes, t('time.decimalMark')))
            : t('help.model.none')}
      </p>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => {
          if (has) void remove();
        }}
        // aria-disabled rather than disabled: disabling the button the user
        // just pressed would drop keyboard focus to the page body.
        aria-disabled={!has}
        data-testid="model-delete"
      >
        {t('help.model.delete')}
      </button>
      <p className="export-log-note" role="status" data-testid="model-storage-message">
        {deleted ? t('help.model.deleted') : ''}
      </p>
    </div>
  );
}
