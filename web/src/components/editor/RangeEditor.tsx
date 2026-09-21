'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/Icon';
import type { ClipV1 } from '@/domain/edl';
import { formatTimecode, parseTimecode, type Micros } from '@/domain/time';
import type { MessageKey } from '@/i18n/messages';

interface Props {
  t: (key: MessageKey) => string;
  disabled: boolean;
  sourceTimeUs: Micros;
  sourceDurationUs: Micros;
  editingClip: ClipV1 | null;
  actionError: MessageKey | null;
  onAdd: (inUs: Micros, outUs: Micros) => boolean;
  onUpdate: (clipId: string, inUs: Micros, outUs: Micros) => boolean;
  onCancelEdit: () => void;
  onPreviewRange: (inUs: Micros) => void;
}

const DEFAULT_LENGTH_US = 4_000_000;
const MIN_SUGGESTION_US = 1_000_000;

// "I" on an English layout (with or without caps) and on Turkish Q, where the
// capital of i is İ. The dotless ı is a different key and is not a shortcut.
const MARK_IN_KEYS = new Set(['i', 'I', 'İ']);
const MARK_OUT_KEYS = new Set(['o', 'O']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function RangeEditor({
  t,
  disabled,
  sourceTimeUs,
  sourceDurationUs,
  editingClip,
  actionError,
  onAdd,
  onUpdate,
  onCancelEdit,
  onPreviewRange,
}: Props) {
  // Mounted fresh per edited clip (EditorApp keys this component), so the
  // initial value is the state — no prop-to-state syncing effect.
  const [startText, setStartText] = useState(() =>
    formatTimecode(editingClip ? editingClip.sourceInUs : 0),
  );
  const [endText, setEndText] = useState(() =>
    formatTimecode(
      editingClip
        ? editingClip.sourceOutUs
        : Math.min(DEFAULT_LENGTH_US, sourceDurationUs || DEFAULT_LENGTH_US),
    ),
  );
  const [localError, setLocalError] = useState<MessageKey | null>(null);

  const startUs = parseTimecode(startText);
  const endUs = parseTimecode(endText);
  const startInvalid = startUs === null;
  const endInvalid = endUs === null;

  const submit = () => {
    if (startUs === null || endUs === null) {
      setLocalError('error.invalid_time');
      return;
    }
    setLocalError(null);
    const ok = editingClip
      ? onUpdate(editingClip.clipId, startUs, endUs)
      : onAdd(startUs, endUs);
    if (ok && !editingClip) {
      // Offer the next range right after the one just kept, clamped to the
      // source so the form never pre-fills something that cannot be added.
      const nextStart = Math.min(endUs, Math.max(0, sourceDurationUs - MIN_SUGGESTION_US));
      const nextEnd = Math.min(nextStart + DEFAULT_LENGTH_US, sourceDurationUs);
      setStartText(formatTimecode(nextStart));
      setEndText(formatTimecode(nextEnd));
    }
  };

  const errorKey = localError ?? actionError;

  // The I / O shortcuts the help dialog lists (doc 06): the same as pressing
  // the I / O buttons. The playhead changes every frame, so the listener reads
  // it from a ref instead of re-subscribing on each render.
  const playheadRef = useRef(sourceTimeUs);
  useEffect(() => {
    playheadRef.current = sourceTimeUs;
  }, [sourceTimeUs]);

  useEffect(() => {
    if (disabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      // Inside a dialog or sheet the letters belong to it, not to the form behind.
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) return;
      if (MARK_IN_KEYS.has(event.key)) {
        event.preventDefault();
        setStartText(formatTimecode(playheadRef.current));
      } else if (MARK_OUT_KEYS.has(event.key)) {
        event.preventDefault();
        setEndText(formatTimecode(playheadRef.current));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled]);

  return (
    <div>
      <div className="range-editor">
        <div className="time-field">
          {/* The button sits beside the label, not inside it: inside, its
              text became part of the field's name ("Başlangıç I ..."). */}
          <div className="time-field-head">
            <label htmlFor="range-start">{t('range.start')}</label>
            <button
              type="button"
              className="mark-btn"
              disabled={disabled}
              onClick={() => setStartText(formatTimecode(sourceTimeUs))}
              title={t('range.setStart')}
              data-testid="mark-start"
            >
              I
              <span className="visually-hidden">{t('range.setStart')}</span>
            </button>
          </div>
          <input
            id="range-start"
            className="time-input"
            value={startText}
            inputMode="decimal"
            aria-invalid={startInvalid}
            disabled={disabled}
            onChange={(event) => setStartText(event.target.value)}
            onBlur={() => {
              if (startUs === null) return;
              // Show what was understood, e.g. "15" -> "00:15.000".
              setStartText(formatTimecode(startUs));
              onPreviewRange(startUs);
            }}
            data-testid="range-start"
          />
        </div>

        <div className="time-field">
          <div className="time-field-head">
            <label htmlFor="range-end">{t('range.end')}</label>
            <button
              type="button"
              className="mark-btn"
              disabled={disabled}
              onClick={() => setEndText(formatTimecode(sourceTimeUs))}
              title={t('range.setEnd')}
              data-testid="mark-end"
            >
              O
              <span className="visually-hidden">{t('range.setEnd')}</span>
            </button>
          </div>
          <input
            id="range-end"
            className="time-input"
            value={endText}
            inputMode="decimal"
            aria-invalid={endInvalid}
            disabled={disabled}
            onChange={(event) => setEndText(event.target.value)}
            onBlur={() => {
              if (endUs !== null) setEndText(formatTimecode(endUs));
            }}
            data-testid="range-end"
          />
        </div>

        <div className="range-add">
          <button
            type="button"
            className="btn btn-accent btn-block"
            onClick={submit}
            disabled={disabled}
            data-testid="add-moment"
          >
            <Icon name={editingClip ? 'check' : 'plus'} />
            {editingClip ? t('range.update') : t('range.add')}
          </button>
        </div>
      </div>

      {editingClip ? (
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={onCancelEdit}>
          {t('range.cancelEdit')}
        </button>
      ) : null}

      {errorKey ? (
        <p className="inline-error" role="alert" data-testid="range-error">
          <Icon name="alert" />
          {t(errorKey)}
        </p>
      ) : null}
    </div>
  );
}
