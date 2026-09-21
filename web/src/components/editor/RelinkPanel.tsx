'use client';

import { useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import { safeFileName } from '@/adapters/browserMedia';
import type { AssetBinding, BindingMatch } from '@/domain/projectRecord';
import { formatBytes } from '@/domain/policy';
import { formatTimecode } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';

interface Props {
  t: (key: MessageKey) => string;
  binding: AssetBinding;
  /** Resolves with the outcome so the panel can explain a mismatch. */
  onPick: (file: File) => Promise<{ ok: true; match: BindingMatch } | { ok: false; reason: string }>;
  /** Called when the user accepts that this is a different file. */
  onUseAsNew: (file: File) => void;
  onDiscardProject?: () => void;
}

/**
 * Asks the user to point a restored project back at its source file.
 *
 * This is the honest half of local persistence: the recipe survives, the files
 * do not, and the user is told exactly which file is being looked for. A file
 * that does not match is never accepted quietly.
 */
export function RelinkPanel({ t, binding, onPick, onUseAsNew, onDiscardProject }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'checking' | 'mismatch'>('idle');

  const isVideo = binding.kind === 'video';

  const handleFile = async (file: File) => {
    setStatus('checking');
    const result = await onPick(file);
    if (result.ok) {
      setStatus('idle');
      setPending(null);
      return;
    }
    if (result.reason === 'mismatch') {
      setPending(file);
      setStatus('mismatch');
      return;
    }
    // Any other reason (unreadable, unsupported) is already shown by the editor.
    setStatus('idle');
    setPending(null);
  };

  return (
    <section className="relink" data-testid={isVideo ? 'relink-video' : 'relink-audio'}>
      <div className="relink-head">
        <Icon name="folder" size={18} />
        <h2>{isVideo ? t('relink.title') : t('relink.audioTitle')}</h2>
      </div>
      <p className="relink-body">{isVideo ? t('relink.body') : t('relink.audioBody')}</p>

      <ul className="meta-list relink-meta">
        <li>
          <span className="meta-key">{t('relink.fileLabel')}</span>
          <span className="meta-value" data-testid="relink-filename">
            {safeFileName(binding.fileName, 48)}
          </span>
        </li>
        <li>
          <span className="meta-key">{t('sources.duration')}</span>
          <span className="meta-value">{formatTimecode(binding.durationUs)}</span>
        </li>
        <li>
          <span className="meta-key">{t('sources.size')}</span>
          <span className="meta-value">{formatBytes(binding.sizeBytes)}</span>
        </li>
      </ul>

      {status === 'mismatch' ? (
        <div className="notice notice-warning" style={{ marginTop: 14 }} data-testid="relink-mismatch">
          <Icon name="alert" size={16} />
          <span>
            <b>{t('relink.mismatchTitle')}</b>
            {t('relink.mismatchBody')}
          </span>
        </div>
      ) : null}

      <div className="relink-actions">
        {status === 'mismatch' && pending ? (
          <>
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => {
                onUseAsNew(pending);
                setPending(null);
                setStatus('idle');
              }}
              data-testid="relink-use-as-new"
            >
              {t('relink.useAsNew')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPending(null);
                setStatus('idle');
              }}
            >
              {t('relink.cancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => inputRef.current?.click()}
            disabled={status === 'checking'}
            data-testid="relink-pick"
          >
            <Icon name="folder" />
            {isVideo ? t('relink.pick') : t('relink.pickAudio')}
          </button>
        )}

        {onDiscardProject && isVideo ? (
          <button
            type="button"
            className="btn btn-danger"
            onClick={onDiscardProject}
            data-testid="relink-discard"
          >
            <Icon name="trash" />
            {t('relink.discard')}
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={isVideo ? 'video/*' : 'audio/*'}
        className="visually-hidden"
        data-testid={isVideo ? 'relink-video-input' : 'relink-audio-input'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleFile(file);
        }}
      />
    </section>
  );
}
