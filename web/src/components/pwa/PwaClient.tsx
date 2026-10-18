'use client';

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
import { sweepSharedVideos } from '@/adapters/pwa/sharedVideo';
import { useT } from '@/i18n/locale';

/**
 * On every page (root layout): registers the service worker, starts
 * listening for the browser's install offer, and shows the quiet "Yeni sürüm
 * hazır" notice when a newer build is waiting (ADR-031). The notice never
 * reloads by itself; its "Yenile" is disabled while a download runs.
 */
export function PwaClient() {
  const t = useT();
  const waiting = useSyncExternalStore(subscribeUpdate, isUpdateWaiting, () => false);
  const busy = useSyncExternalStore(subscribeAppBusy, isAppBusy, () => false);

  useEffect(() => {
    listenForInstallPrompt();
    registerServiceWorker();
    // "LiloCut'a paylaş" (ADR-047): a shared video this page is not about, or one that waited too long,
    // is deleted at every start. A browser never shared to has nothing to delete (nothing is created).
    void sweepSharedVideos(window.location.search);
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
