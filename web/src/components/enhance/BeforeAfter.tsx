'use client';

import { useEffect, useId, useRef, useState } from 'react';

import type { EnhanceSummary } from '@/domain/enhance';
import type { MessageKey } from '@/i18n/messages';
import type { EnhancePreviewPicture, EnhancePreviewState } from './useEnhancePreview';

type T = (key: MessageKey) => string;

/** What the plan changes, as the words of a sentence ("renkler toparlanır, kenarlar keskinleştirilir"). */
export function enhanceItems(t: T, summary: EnhanceSummary, tense: 'will' | 'did'): string[] {
  const items: string[] = [];
  if (summary.light !== 'none') items.push(t(`enhance.${tense}.light.${summary.light}` as MessageKey));
  if (summary.colour) items.push(t(`enhance.${tense}.colour` as MessageKey));
  if (summary.sharpen) items.push(t(`enhance.${tense}.sharpen` as MessageKey));
  if (summary.denoise) items.push(t(`enhance.${tense}.denoise` as MessageKey));
  return items;
}

function failureText(t: T, reason: Extract<EnhancePreviewState, { status: 'failed' }>['reason']): string {
  if (reason === 'hdr_source_unsupported' || reason === 'source_undecodable') {
    return t(`enhance.preview.failed.${reason}` as MessageKey);
  }
  return t('enhance.preview.failed.other');
}

/** Draws a bitmap into a canvas of its own size (a copy: the bitmap may be closed afterwards). */
function paint(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap, width: number, height: number): void {
  if (!canvas) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
}

interface Props {
  t: T;
  state: EnhancePreviewState;
  /** Shows another frame of the video; absent where there is no such button. */
  onOtherFrame?: () => void;
  onRetry: () => void;
  /** Controls must not change under a running download. */
  disabled?: boolean;
  /** Smaller, for the editor's settings drawer. */
  compact?: boolean;
}

/**
 * "Öncesi ve sonrası" (ADR-037): one real frame of the user's video, as it
 * is and enhanced, under a line the user moves. Left of the line is the
 * video as it is, right of it the enhanced picture; both were made by the
 * export worker with the code the download runs, so this is not a prettier
 * preview of something else.
 *
 * The line is a native range input laid over the picture: it follows the
 * pointer and a finger, and the arrow keys, Page Up/Down, Home and End move
 * it for the keyboard; a screen reader hears how much of the picture is the
 * earlier version.
 */
export function BeforeAfter({ t, state, onOtherFrame, onRetry, disabled = false, compact = false }: Props) {
  const beforeRef = useRef<HTMLCanvasElement | null>(null);
  const afterRef = useRef<HTMLCanvasElement | null>(null);
  const [split, setSplit] = useState(50);
  const hintId = useId();

  const picture: EnhancePreviewPicture | null =
    state.status === 'ready' ? state.picture : state.status === 'loading' ? state.previous : null;
  const loading = state.status === 'loading';

  // A new picture: copy both bitmaps into the canvases (the hook closes the bitmaps it replaces).
  const drawnRef = useRef<EnhancePreviewPicture | null>(null);
  useEffect(() => {
    if (state.status !== 'ready' || drawnRef.current === state.picture) return;
    drawnRef.current = state.picture;
    paint(beforeRef.current, state.picture.before, state.picture.width, state.picture.height);
    paint(afterRef.current, state.picture.after, state.picture.width, state.picture.height);
  }, [state]);

  if (state.status === 'idle') return null;

  if (state.status === 'failed') {
    return (
      <div className="ba ba-message" data-compact={compact} data-testid="enhance-preview" data-status="failed">
        <p className="ba-failed" role="alert" data-testid="enhance-preview-failed" data-reason={state.reason}>
          {failureText(t, state.reason)}
        </p>
        {state.reason === 'hdr_source_unsupported' || state.reason === 'source_undecodable' ? null : (
          <button type="button" className="btn" onClick={onRetry} data-testid="enhance-preview-retry">
            {t('enhance.preview.retry')}
          </button>
        )}
      </div>
    );
  }

  const percent = state.status === 'loading' && state.progress !== null ? Math.round(state.progress * 100) : null;
  const loadingText = state.status === 'loading' && state.progress === null && picture ? t('enhance.preview.making') : t('enhance.preview.loading');

  return (
    <div
      className="ba"
      data-compact={compact}
      data-testid="enhance-preview"
      data-status={state.status}
      data-engine={picture?.engine}
      data-accelerated={picture ? String(picture.accelerated) : undefined}
      data-frame={picture?.frame}
    >
      {picture ? (
        <div
          className="ba-frame"
          role="group"
          aria-label={t('enhance.preview.label')}
          aria-busy={loading}
          // The frame keeps the video's own shape, never taller than about 60 % of the screen.
          style={{
            aspectRatio: `${picture.width} / ${picture.height}`,
            maxWidth: `calc(${compact ? 34 : 58}vh * ${Math.round((picture.width / picture.height) * 10000) / 10000})`,
            ['--ba-split' as string]: `${split}%`,
          }}
          data-testid="enhance-frame"
        >
          <canvas ref={afterRef} className="ba-picture" aria-hidden="true" data-testid="enhance-after" />
          <canvas ref={beforeRef} className="ba-picture ba-before" aria-hidden="true" data-testid="enhance-before" />
          <span className="ba-tag ba-tag-before" aria-hidden="true">
            {t('enhance.preview.before')}
          </span>
          <span className="ba-tag ba-tag-after" aria-hidden="true">
            {t('enhance.preview.after')}
          </span>
          <input
            className="ba-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={split}
            disabled={disabled}
            onChange={(event) => setSplit(Number(event.target.value))}
            aria-label={t('enhance.preview.slider')}
            aria-valuetext={t('enhance.preview.sliderValue').replace('{n}', String(split))}
            aria-describedby={hintId}
            data-testid="enhance-slider"
          />
          {/* After the input in the document, so its focus ring can be drawn on the handle (`:focus-visible + .ba-line`). */}
          <span className="ba-line" aria-hidden="true">
            <span className="ba-handle" />
          </span>
        </div>
      ) : (
        <div className="ba-message" data-testid="enhance-preview-loading">
          <p className="ba-loading-title">{t('enhance.preview.loading')}</p>
          <p className="hint-small">{t('enhance.preview.loadingHint')}</p>
        </div>
      )}

      {/* One live region for "looking…" and for the real share of the frames looked at. */}
      <div className="ba-status" role="status" data-testid="enhance-preview-status">
        {loading ? (
          <>
            <span className="visually-hidden">{loadingText}</span>
            <div
              className="progress-track"
              role="progressbar"
              aria-label={loadingText}
              aria-valuemin={0}
              aria-valuemax={100}
              {...(percent === null ? {} : { 'aria-valuenow': percent })}
            >
              <div
                className={percent === null ? 'progress-fill progress-indeterminate' : 'progress-fill'}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
          </>
        ) : null}
      </div>

      {picture ? (
        <>
          <p className="hint-small ba-hint" id={hintId}>
            {t('enhance.preview.sliderHint')}
          </p>
          <div className="ba-foot">
            <p className="hint-small">{t('enhance.preview.note')}</p>
            {onOtherFrame ? (
              <button
                type="button"
                className="btn btn-compact"
                onClick={onOtherFrame}
                disabled={disabled || loading}
                data-testid="enhance-other-frame"
              >
                {t('enhance.preview.other')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
