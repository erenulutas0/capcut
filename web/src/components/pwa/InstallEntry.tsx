'use client';

import { useSyncExternalStore } from 'react';

import { Icon } from '@/components/Icon';
import { installState, promptInstall, subscribeInstall, type InstallState } from '@/adapters/pwa/installPrompt';
import type { MessageKey } from '@/i18n/messages';

/**
 * "Uygulama olarak yükle" in the ⋯ menu (ADR-031): the browser's own install
 * question where it offered one (Chromium), the "Ana Ekrana Ekle" steps on
 * iPhone/iPad Safari, nothing anywhere else.
 */
export function InstallEntry({ t }: { t: (key: MessageKey) => string }) {
  const state = useSyncExternalStore<InstallState>(subscribeInstall, installState, () => 'none');
  if (state === 'none') return null;
  if (state === 'ios') {
    return (
      <>
        <hr className="divider" />
        <div data-testid="install-ios">
          <p className="field-label">{t('pwa.install.iosTitle')}</p>
          <p className="hint-small">{t('pwa.install.ios')}</p>
        </div>
      </>
    );
  }
  return (
    <>
      <hr className="divider" />
      <button
        type="button"
        className="btn btn-block"
        onClick={() => void promptInstall()}
        aria-describedby="install-app-hint"
        data-testid="install-app"
      >
        <Icon name="install" />
        {t('pwa.install')}
      </button>
      <p className="hint-small" id="install-app-hint">
        {t('pwa.install.hint')}
      </p>
    </>
  );
}
