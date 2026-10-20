'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import type { GifJob } from '@/adapters/gif/gifClient';
import { gifMeasure } from '@/adapters/gif/gifText';
import { CAPTION_FONT_FAMILY } from '@/adapters/captionRender';
import { ownSizeRecipe } from '@/application/taskRecipes';
import { FailureDetails } from '@/components/FailureDetails';
import { Icon } from '@/components/Icon';
import { useCaptionFont } from '@/components/editor/useCaptionFont';
import { useLayoutMode } from '@/components/editor/useLayoutMode';
import { useTouchScreen } from '@/components/editor/useTouchScreen';
import { WizardFlow, fill, lengthText, type WizardHostProps } from '@/components/wizard/WizardFlow';
import {
  GIF_TEXT_MAX_CHARS,
  gifFileName,
  gifRangeLength,
  gifTextMaxPx,
  initialGifRange,
  layoutGifText,
  gifIsLarge,
  gifSizeChoices,
  normalizeGifRange,
  planGifSize,
  type GifRange,
  type GifSize,
  type GifSizeId,
  type GifTextLayout,
  type GifTexts,
  type MeasureGifText,
} from '@/domain/gif';
import { formatBytes } from '@/domain/policy';
import { useT } from '@/i18n/locale';
import { GifRangeBar } from './GifRangeBar';
import { GifStatus, gifFailureText } from './GifStatus';
import { useGifDownload, useGifEstimate } from './useGif';


/** Refusals the estimate already proves: the GIF could not be made either, so "GIF'i indir" waits. */
const BLOCKING = new Set(['no_video_track', 'source_undecodable', 'source_incomplete', 'hdr_source_unsupported', 'no_frames_decoded', 'source_frames_missing', 'text_font_unavailable']);

const SIZE_LABEL: Record<GifSizeId, 'wizard.gif.small' | 'wizard.gif.medium' | 'wizard.gif.large'> = {
  small: 'wizard.gif.small',
  medium: 'wizard.gif.medium',
  large: 'wizard.gif.large',
};

let pageMeasureFn: MeasureGifText | null = null;

/**
 * A width measure of the caption typeface on this page; null outside a browser. The preview is drawn
 * again when the typeface arrives (`useCaptionFont`), and the measure then gives its widths.
 */
function pageMeasure(): MeasureGifText | null {
  if (pageMeasureFn) return pageMeasureFn;
  if (typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  pageMeasureFn = context ? gifMeasure(context) : null;
  return pageMeasureFn;
}

/**
 * One text box over the preview (mockup B): where the text will be in the GIF, in the GIF's own
 * letters, as large as they will be there (the layout of `layoutGifText` scaled to the preview), so
 * what is typed wraps where it will wrap in the file.
 */
function TextBox({
  where,
  value,
  onChange,
  layout,
  size,
  scale,
  disabled,
}: {
  where: 'top' | 'bottom';
  value: string;
  onChange: (value: string) => void;
  layout: GifTextLayout | null;
  size: GifSize;
  scale: number;
  disabled: boolean;
}) {
  const t = useT();
  // An empty box keeps the size the first letters will have, so it can be found and tapped.
  const fontPx = (layout?.fontPx ?? gifTextMaxPx(size)) * scale;
  const lineHeight = (layout?.lineHeightPx ?? Math.round(gifTextMaxPx(size) * 1.15)) * scale;
  const lines = Math.max(1, layout?.lines.length ?? 1);
  const edge = Math.max(1, (layout?.outlinePx ?? 2) * scale);
  const margin = Math.round(size.height * 0.04) * scale;
  const style = {
    '--gif-font': `${fontPx}px`,
    '--gif-line': `${lineHeight}px`,
    '--gif-edge': `${edge}px`,
    '--gif-lines': lines,
    '--gif-margin': `${Math.max(4, margin - 4)}px`,
    '--gif-width': `${((layout?.maxWidth ?? Math.round(size.width * 0.92)) * scale)}px`,
    fontFamily: `"${CAPTION_FONT_FAMILY}", var(--font-ui)`,
  } as CSSProperties;
  const label = t(where === 'top' ? 'wizard.gif.topLabel' : 'wizard.gif.bottomLabel');
  return (
    <textarea
      className="gif-text"
      data-where={where}
      data-filled={value.trim().length > 0}
      style={style}
      value={value}
      rows={lines}
      maxLength={GIF_TEXT_MAX_CHARS}
      disabled={disabled}
      placeholder={t(where === 'top' ? 'wizard.gif.topPlaceholder' : 'wizard.gif.bottomPlaceholder')}
      aria-label={label}
      enterKeyHint="done"
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(event) => {
        // One text, two lines at most: Enter means "done", not a new line.
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      data-testid={`gif-text-${where}`}
    />
  );
}

/**
 * The GIF preview (mockup B): the chosen part plays over and over, without sound, in the GIF's own
 * shape; the two text boxes sit where the text will be. A button stops and starts it (anything that
 * moves on its own can be stopped).
 */
function GifPreview({
  src,
  range,
  size,
  texts,
  onTexts,
  measure,
  disabled,
}: {
  src: string;
  range: GifRange;
  size: GifSize;
  texts: GifTexts;
  onTexts: (texts: GifTexts) => void;
  measure: MeasureGifText | null;
  disabled: boolean;
}) {
  const t = useT();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [width, setWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const rangeRef = useRef(range);
  const pausedRef = useRef(paused);
  useEffect(() => {
    rangeRef.current = range;
    pausedRef.current = paused;
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const observer = new ResizeObserver(() => setWidth(frame.clientWidth));
    observer.observe(frame);
    setWidth(frame.clientWidth);
    return () => observer.disconnect();
  }, []);

  // A new part starts the loop from its beginning.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = range.startUs / 1_000_000;
    if (!pausedRef.current) void video.play().catch(() => undefined);
  }, [range.startUs, range.endUs]);

  // The loop: back to the start of the part when it is over (checked at every frame where the browser can).
  useEffect(() => {
    const video = videoRef.current as (HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    }) | null;
    if (!video) return undefined;
    const check = () => {
      const { startUs, endUs } = rangeRef.current;
      const now = video.currentTime * 1_000_000;
      if (now >= endUs || now < startUs - 100_000 || video.ended) {
        video.currentTime = startUs / 1_000_000;
        if (video.paused && !pausedRef.current) void video.play().catch(() => undefined);
      }
    };
    let handle = 0;
    const onFrame = () => {
      check();
      handle = video.requestVideoFrameCallback?.(onFrame) ?? 0;
    };
    if (typeof video.requestVideoFrameCallback === 'function') handle = video.requestVideoFrameCallback(onFrame);
    video.addEventListener('timeupdate', check);
    video.addEventListener('ended', check);
    return () => {
      video.removeEventListener('timeupdate', check);
      video.removeEventListener('ended', check);
      if (handle && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(handle);
    };
  }, [src]);

  const scale = width > 0 ? width / size.width : 1;
  const top = measure ? layoutGifText(texts.top, 'top', size, measure) : null;
  const bottom = measure ? layoutGifText(texts.bottom, 'bottom', size, measure) : null;

  return (
    <div className="gif-preview" data-testid="gif-preview">
      <div
        className="gif-preview-frame"
        ref={frameRef}
        style={{ aspectRatio: `${size.width} / ${size.height}`, '--gif-ratio': size.width / size.height } as CSSProperties}
        data-testid="gif-preview-frame"
      >
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          autoPlay
          preload="auto"
          aria-label={t('wizard.gif.preview')}
          onPlay={() => setPaused(false)}
          data-testid="gif-video"
        />
        <TextBox where="top" value={texts.top} onChange={(top) => onTexts({ ...texts, top })} layout={top} size={size} scale={scale} disabled={disabled} />
        <TextBox where="bottom" value={texts.bottom} onChange={(value) => onTexts({ ...texts, bottom: value })} layout={bottom} size={size} scale={scale} disabled={disabled} />
      </div>
      <div className="gif-preview-bar">
        <button
          type="button"
          className="btn btn-compact"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (paused) {
              setPaused(false);
              void video.play().catch(() => undefined);
            } else {
              setPaused(true);
              video.pause();
            }
          }}
          aria-label={t(paused ? 'wizard.gif.play' : 'wizard.gif.pause')}
          data-testid="gif-play"
        >
          <Icon name={paused ? 'play' : 'pause'} size={18} />
        </button>
        <p className="wizard-hint">{t('wizard.gif.textHint')}</p>
      </div>
      {top?.truncated || bottom?.truncated ? (
        <p className="wizard-blocked" role="status" data-testid="gif-text-too-long">
          {t('wizard.gif.tooLong')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "GIF yap" (ADR-046, mockup B "Tek ekran, yazı önizlemenin üstünde"): after the video, one screen —
 * the part plays over and over with the text boxes on it, the bar picks the part (at most ten
 * seconds) with an honest "yaklaşık 3 MB" measured from frames really made, the size, and one
 * button. Everything happens on this device, in the GIF worker; the file is saved like every other
 * download (the save dialog where the browser has one, a save link where it has not).
 */
export default function GifWizard(host: WizardHostProps) {
  const t = useT();
  const { state } = host;
  const { video } = state;
  const phone = useLayoutMode() === 'phone';
  const touchScreen = useTouchScreen();
  // Read for its re-render: the text boxes are measured again once the typeface is here.
  useCaptionFont();
  const measure = video ? pageMeasure() : null;
  const [range, setRange] = useState<GifRange | null>(null);
  const [capped, setCapped] = useState(false);
  // "Orta" first where the video has it (founder's decision, 20 Oct 2026: on a phone "Küçük" looked blurred;
  // ADR-046 addendum). A video that has no "Orta" gets its largest size, which is its own.
  const [sizeId, setSizeId] = useState<GifSizeId>('medium');
  const [texts, setTexts] = useState<GifTexts>({ top: '', bottom: '' });
  const download = useGifDownload();
  const busy = download.busy;

  const videoUs = video?.durationUs ?? 0;
  const part = video && range ? normalizeGifRange(range, videoUs) : null;
  const videoWidth = video?.displayWidth ?? 0;
  const videoHeight = video?.displayHeight ?? 0;
  const sizeChoices = videoWidth > 0 && videoHeight > 0 ? gifSizeChoices(videoWidth, videoHeight) : (['small'] as GifSizeId[]);
  const twoSizes = sizeChoices.length > 1;
  // A size this video does not have (a smaller video after a larger one): its largest.
  const chosenSize: GifSizeId = sizeChoices.includes(sizeId) ? sizeId : (sizeChoices[sizeChoices.length - 1] ?? 'small');
  const size = planGifSize(videoWidth || 1, videoHeight || 1, chosenSize);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const job: GifJob | null = video && part ? { file: video.file, range: part, size: chosenSize, texts, origin } : null;
  // What the estimate is for: it is measured again only when this changes.
  const key = job ? `${video?.objectUrl}|${job.range.startUs}|${job.range.endUs}|${job.size}|${job.texts.top}|${job.texts.bottom}` : '';
  const estimate = useGifEstimate(download.maker, job, key);
  const current = estimate.status !== 'idle' && estimate.key === key ? estimate : null;
  const refusal = current?.status === 'failed' && BLOCKING.has(current.reason) ? current : null;
  const estimateProblem = current?.status === 'failed' && !refusal ? current : null;

  const onRange = useCallback((next: GifRange, wasCapped: boolean) => {
    setRange(next);
    setCapped(wasCapped);
  }, []);

  const lengthUs = part ? gifRangeLength(part) : 0;
  const mark = t('time.decimalMark');
  const estimateText = !part
    ? ''
    : current?.status === 'ready'
      ? fill(t('wizard.gif.estimate'), { length: lengthText(lengthUs, t), size: formatBytes(current.bytes, mark) })
      : fill(t('wizard.gif.measuring'), { length: lengthText(lengthUs, t) });

  const status = download.state;
  const ownDownload = {
    phase: status?.phase ?? null,
    busy,
    readyTitle: t('wizard.gif.ready'),
    cancel: download.cancel,
    dismiss: download.dismiss,
    status: status ? (
      <GifStatus t={t} state={status} device={phone || touchScreen} onCancel={download.cancel} onShare={download.share} />
    ) : null,
  };

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.gif.title"
      fileTag="gif"
      recipe={null}
      ownDownload={ownDownload}
      preview={
        video && part ? (
          <GifPreview
            src={video.objectUrl}
            range={part}
            size={size}
            texts={texts}
            onTexts={setTexts}
            measure={measure}
            disabled={busy}
          />
        ) : undefined
      }
      openVideo={async (file) => {
        download.dismiss();
        const outcome = await state.importVideo(file, ownSizeRecipe);
        if (outcome.kind !== 'opened') return false;
        setRange(initialGifRange(outcome.lengthUs));
        setCapped(false);
        return true;
      }}
    >
      {video && part ? (
        <>
          <div className="gif-part" data-testid="gif-part">
            <GifRangeBar
              videoUs={videoUs}
              range={part}
              disabled={busy}
              onChange={onRange}
              labels={{
                window: t('wizard.gif.partLabel'),
                start: t('wizard.gif.startLabel'),
                end: t('wizard.gif.endLabel'),
                valueText: (from, to) => fill(t('wizard.gif.partValue'), { from, to }),
              }}
            />
            <div className="gif-part-line">
              <span>{t('wizard.gif.part')}</span>
              <span
                className="gif-estimate"
                role="status"
                data-testid="gif-estimate"
                data-state={current?.status ?? 'measuring'}
                data-bytes={current?.status === 'ready' ? current.bytes : undefined}
                data-frames={current?.status === 'ready' ? current.frames : undefined}
                data-width={current?.status === 'ready' ? current.width : undefined}
                data-height={current?.status === 'ready' ? current.height : undefined}
              >
                {estimateText}
              </span>
            </div>
            {capped ? (
              <p className="wizard-blocked" role="status" data-testid="gif-max-length">
                {t('wizard.gif.maxLength')}
              </p>
            ) : null}
          </div>

          {twoSizes ? (
            <fieldset className="gif-size" data-testid="gif-size" aria-describedby="gif-size-hint">
              <legend>{t('wizard.gif.size')}</legend>
              {sizeChoices.map((id) => (
                <label className="gif-size-option" data-checked={chosenSize === id} key={id}>
                  <input
                    type="radio"
                    name="gif-size"
                    value={id}
                    checked={chosenSize === id}
                    disabled={busy}
                    onChange={() => setSizeId(id)}
                    data-testid={`gif-size-${id}`}
                  />
                  <span>{t(SIZE_LABEL[id])}</span>
                </label>
              ))}
              {/* The honest trade (ADR-046 addendum): a larger GIF looks sharper on a phone, and its file is larger. */}
              <p className="wizard-hint gif-size-hint" id="gif-size-hint" data-testid="gif-size-hint">
                {t('wizard.gif.sizeHint')}
              </p>
            </fieldset>
          ) : (
            <p className="wizard-hint" data-testid="gif-one-size">
              {t('wizard.gif.oneSize')}
            </p>
          )}

          {current?.status === 'ready' && gifIsLarge(current.bytes) ? (
            // Said, never blocked: the GIF is still made if the user wants it this large.
            <p className="wizard-blocked" role="status" data-testid="gif-too-large">
              {t('wizard.gif.tooLarge')}
            </p>
          ) : null}

          {refusal ? (
            <div className="wizard-panel" data-testid="gif-refused" data-reason={refusal.reason}>
              <p className="wizard-panel-title" role="alert">
                {gifFailureText(t, refusal.reason)}
              </p>
            </div>
          ) : null}
          {estimateProblem ? (
            <div className="wizard-panel" data-testid="gif-estimate-failed" data-reason={estimateProblem.reason}>
              <p className="wizard-panel-title" role="status">
                {t('wizard.gif.estimateFailed')}
              </p>
              <FailureDetails t={t} detail={estimateProblem.detail} testId="gif-estimate" />
            </div>
          ) : null}

          <div className="wizard-actions wizard-action-bar" data-testid="wizard-actions">
            <button
              type="button"
              className="btn btn-accent wizard-go"
              onClick={() => {
                if (job) download.start(job, gifFileName(video.fileName));
              }}
              disabled={!job || busy || refusal !== null || state.importing === 'video'}
              data-testid="wizard-download"
            >
              <Icon name="download" />
              {t('wizard.gif.download')}
            </button>
          </div>
        </>
      ) : null}
    </WizardFlow>
  );
}
