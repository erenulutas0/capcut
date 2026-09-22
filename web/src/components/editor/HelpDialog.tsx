'use client';

import { withBasePath } from '@/basePath';
import { Icon } from '@/components/Icon';
import { Dialog } from './Dialog';
import type { MessageKey } from '@/i18n/messages';

const SHORTCUTS: Array<[string, MessageKey]> = [
  ['Space', 'help.shortcut.space'],
  ['← / → · Shift · Home / End', 'help.shortcut.playhead'],
  ['S', 'help.shortcut.split'],
  ['Delete · Backspace', 'help.shortcut.delete'],
  ['← / → · Shift', 'help.shortcut.trim'],
  ['I / O', 'help.shortcut.io'],
  ['Ctrl+Z · Ctrl+Shift+Z', 'help.shortcut.undo'],
  ['Esc', 'help.shortcut.escape'],
];

const LIMITS: MessageKey[] = [
  'help.limit.length',
  'help.limit.export',
  'help.limit.mix',
  'help.limit.save',
  'help.limit.cloud',
];

export function HelpDialog({
  t,
  open,
  onClose,
  onReportProblem,
}: {
  t: (key: MessageKey) => string;
  open: boolean;
  onClose: () => void;
  /** Opens "Sorun bildir" on top of this dialog. */
  onReportProblem: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="help-title">
      <div className="dialog-head">
        <h2 id="help-title">{t('help.title')}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('help.close')}>
          <Icon name="close" />
        </button>
      </div>

      <p className="field-label">{t('help.shortcuts')}</p>
      <ul className="meta-list">
        {SHORTCUTS.map(([keys, labelKey]) => (
          <li key={labelKey}>
            <span className="meta-key">{t(labelKey)}</span>
            <span className="meta-value">{keys}</span>
          </li>
        ))}
      </ul>
      <p className="hint-small">{t('help.shortcutNote')}</p>

      <hr className="divider" />

      <p className="field-label">{t('help.limits')}</p>
      <ul className="meta-list">
        {LIMITS.map((key) => (
          <li key={key}>
            <span className="meta-key">{t(key)}</span>
          </li>
        ))}
      </ul>

      <hr className="divider" />

      <p className="field-label">{t('support.section')}</p>
      <div className="help-support">
        {/* A new tab: leaving the editor would close the files opened in it. */}
        <a className="btn" href={withBasePath('/gizlilik')} target="_blank" rel="noopener" data-testid="help-privacy-link">
          <Icon name="shield" />
          {t('privacy.linkNewTab')}
        </a>
        <button type="button" className="btn" onClick={onReportProblem} data-testid="open-report">
          <Icon name="alert" />
          {t('support.open')}
        </button>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('help.close')}
        </button>
      </div>
    </Dialog>
  );
}
