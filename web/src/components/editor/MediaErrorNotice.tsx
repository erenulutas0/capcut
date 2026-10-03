'use client';

import { safeFileName } from '@/adapters/browserMedia';
import { Icon } from '@/components/Icon';
import type { MessageKey } from '@/i18n/messages';
import { refusedFileText } from './mediaErrorText';
import type { MediaError } from './useEditorState';

/**
 * Why a picked file was not opened (too large, too long, not a video this
 * browser reads…), with the hint for HEVC without a decoder. The editor and
 * the task wizards say it with the same sentence.
 */
export function MediaErrorNotice({
  t,
  error,
  onDismiss,
}: {
  t: (key: MessageKey) => string;
  error: MediaError | null;
  onDismiss: () => void;
}) {
  if (!error) return null;
  const main = refusedFileText(t, {
    reason: error.reason,
    name: safeFileName(error.fileName, 60),
    ...(error.bytes === undefined ? {} : { bytes: error.bytes }),
  });
  const text = error.keptOpen ? `${main} ${t(error.scope === 'video' ? 'error.keptVideo' : 'error.keptAudio')}` : main;
  return (
    <div className="inline-error media-error" role="alert" data-testid="media-error">
      <Icon name="alert" />
      <span>
        {text}
        {error.hint === 'hevc_decoder_missing' ? (
          <>
            {' '}
            <span className="media-error-hint" data-testid="media-error-hint">
              {t('error.hint.hevc_decoder_missing')}
            </span>
          </>
        ) : null}
      </span>
      <button
        type="button"
        className="icon-btn media-error-close"
        onClick={onDismiss}
        aria-label={t('error.dismiss')}
        data-testid="media-error-dismiss"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
