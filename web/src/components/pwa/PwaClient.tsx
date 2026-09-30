'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';

import { listenForInstallPrompt } from '@/adapters/pwa/installPrompt';
import {
  applyUpdate,
  dismissUpdate,
  isAppBusy,
  isUpdateWaiting,
  registerServiceWorker,
  subscribeAppBusy,
  subscribeUpdate,
} from '@/adapters/pwa/serviceWorker';
import { translator } from '@/i18n/messages';

/**
 * On every page (root layout): registers the service worker, starts
 * listening for the browser's install offer, and shows the quiet "Yeni sürüm
 * hazır" notice when a newer build is waiting (ADR-031). The notice never
 * reloads by itself; its "Yenile" is disabled while a download runs.
 */
export function PwaClient() {
  const pathname = usePathname();
  const t = translator(pathname?.startsWith('/gizlilik/en') ? 'en' : 'tr');
  const waiting = useSyncExternalStore(subscribeUpdate, isUpdateWaiting, () => false);
  const busy = useSyncExternalStore(subscribeAppBusy, isAppBusy, () => false);

  useEffect(() => {
    listenForInstallPrompt();
    registerServiceWorker();
  }, []);

  if (!waiting) return null;
  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      <p className="update-notice-text">
        <b>{t('pwa.update.title')}</b>
        {busy ? <span data-testid="update-busy">{t('pwa.update.busy')}</span> : null}
      </p>
      <div className="update-notice-actions">
        <button type="button" className="update-notice-button" onClick={() => dismissUpdate()} data-testid="update-later">
          {t('pwa.update.later')}
        </button>
        <button
          type="button"
          className="update-notice-button update-notice-primary"
          onClick={() => applyUpdate()}
          disabled={busy}
          data-testid="update-reload"
        >
          {t('pwa.update.reload')}
        </button>
      </div>
    </div>
  );
}
