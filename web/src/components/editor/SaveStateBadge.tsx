'use client';

import { Icon } from '@/components/Icon';
import type { SaveState } from './useProjectPersistence';
import type { MessageKey } from '@/i18n/messages';

/**
 * Says what actually happened to the user's work.
 *
 * "Kaydedildi" is only shown after a transaction committed, and its tooltip
 * states plainly that this is browser storage rather than a backup. A refused
 * save is never rounded up to a success.
 */
export function SaveStateBadge({
  t,
  state,
  onDownloadBackup,
}: {
  t: (key: MessageKey) => string;
  state: SaveState;
  onDownloadBackup: () => void;
}) {
  if (state.kind === 'failed') {
    return (
      <span className="save-state save-state-failed" data-testid="save-state">
        <Icon name="alert" size={15} />
        <span>
          {t('topbar.saveState.failed')} · {t(`store.fail.${state.reason}` as MessageKey)}
        </span>
        <button type="button" className="link-button" onClick={onDownloadBackup} data-testid="save-recover">
          {t('backup.download')}
        </button>
      </span>
    );
  }

  const label =
    state.kind === 'saving'
      ? t('topbar.saveState.saving')
      : state.kind === 'saved'
        ? `${t('topbar.saveState.saved')} · ${new Date(state.at).toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
          })}`
        : t('topbar.saveState.idle');

  return (
    <span className="save-state" title={t('topbar.saveState.hint')} data-testid="save-state">
      <span
        className="save-dot"
        data-kind={state.kind}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
