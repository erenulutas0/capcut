'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { GifJob } from '@/adapters/gif/gifClient';
import { gifMeasure } from '@/adapters/gif/gifText';
import { CAPTION_FONT_FAMILY } from '@/adapters/captionRender';
import { gifVideoRecipe, ownSizeRecipe } from '@/application/taskRecipes';
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
  sharpestShareableGifSize,
  type GifOutput,
  type GifRange,
  type GifSize,
  type GifSizeEstimates,
  type GifSizeId,
  type GifTextLayout,
  type GifTexts,
  type MeasureGifText,
} from '@/domain/gif';
import { WEB_LOCAL_POLICY, formatBytes } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { useT } from '@/i18n/locale';
import { GifRangeBar } from './GifRangeBar';
import { GifStatus, gifFailureText } from './GifStatus';
import { useGifDownload, useGifEstimate, useGifEstimatesDone } from './useGif';


/** Refusals the estimate already proves: the GIF could not be made either, so "GIF'i indir" waits. */
const BLOCKING = new Set(['no_video_track', 'source_undecodable', 'source_incomplete', 'hdr_source_unsupported', 'no_frames_decoded', 'source_frames_missing', 'text_font_unavailable']);

const SIZE_LABEL: Record<GifSizeId, 'wizard.gif.small' | 'wizard.gif.medium' | 'wizard.gif.large' | 'wizard.gif.xlarge'> = {
  small: 'wizard.gif.small',
  medium: 'wizard.gif.medium',
  large: 'wizard.gif.large',
  xlarge: 'wizard.gif.xlarge',
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
  cover = false,
}: {
  src: string;
  range: GifRange;
  size: GifSize;
  texts: GifTexts;
  onTexts: (texts: GifTexts) => void;
  measure: MeasureGifText | null;
  disabled: boolean;
  /**
   * The video's frame (ADR-052): the picture fills it as the export fills it (centred, cut at the edges —
   * only where the video's own shape is not 16:9, 9:16 or square). The GIF is the video's own shape.
   */
  cover?: boolean;
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
        data-fit={cover ? 'cover' : 'fill'}
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
 *
 * ADR-052: the size chosen first is the sharpest that stays under 10 MB, measured from the largest
 * down (`sharpestShareableGifSize`); and the same part can be saved as a short video instead
 * ("Video olarak (en net)") — through the ordinary MP4 download (`WizardFlow`'s own), with the
 * same text drawn the GIF's way.
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
  // The size the user picked; null until they pick one: the sharpest that fits 10 MB is then chosen for
  // them (ADR-052; before 21 Oct 2026 "Orta", the founder's decision of 20 Oct).
  const [userSize, setUserSize] = useState<GifSizeId | null>(null);
  // GIF first: the card is "GIF yap", and a GIF is the one file every place shows as a GIF (ADR-052).
  const [output, setOutput] = useState<GifOutput>('gif');
  const [texts, setTexts] = useState<GifTexts>({ top: '', bottom: '' });
  const download = useGifDownload();
  const asVideo = output === 'video';

  const videoUs = video?.durationUs ?? 0;
  const part = video && range ? normalizeGifRange(range, videoUs) : null;
  const videoWidth = video?.displayWidth ?? 0;
  const videoHeight = video?.displayHeight ?? 0;
  const sizeChoices = videoWidth > 0 && videoHeight > 0 ? gifSizeChoices(videoWidth, videoHeight) : (['small'] as GifSizeId[]);
  const twoSizes = sizeChoices.length > 1;

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  /** What an estimate is for: it is measured again only when this changes. */
  const keyFor = (id: GifSizeId) => (video && part ? `${video.objectUrl}|${part.startUs}|${part.endUs}|${id}|${texts.top}|${texts.bottom}` : '');

  // ADR-052: what is known of every size of this part and text, and from it the sharpest that fits.
  const [done, record] = useGifEstimatesDone();
  const known: GifSizeEstimates = {};
  for (const id of sizeChoices) {
    const finished = done[keyFor(id)];
    if (finished) known[id] = finished.status === 'ready' ? finished.bytes : 'failed';
  }
  const auto = sharpestShareableGifSize(sizeChoices, known);
  const userChose = userSize !== null && sizeChoices.includes(userSize);
  const chosenSize: GifSizeId = userChose ? (userSize as GifSizeId) : auto.size;
  // Still measuring the sizes from the largest down: no size is "chosen" yet, and no GIF is made at a guess.
  const picking = !asVideo && twoSizes && !userChose && auto.kind === 'measure';
  const size = planGifSize(videoWidth || 1, videoHeight || 1, chosenSize);

  const job: GifJob | null = video && part && !asVideo ? { file: video.file, range: part, size: chosenSize, texts, origin } : null;
  const key = job ? keyFor(chosenSize) : '';
  // The next size of the search follows the last one at once: nothing was changed by hand in between.
  const searching = picking && sizeChoices.some((id) => done[keyFor(id)] !== undefined);
  const latest = useGifEstimate(download.maker, job, key, done, record, searching ? 0 : undefined);
  const current = job ? (done[key] ?? (latest.status !== 'idle' && latest.key === key ? latest : null)) : null;
  const refusal = current?.status === 'failed' && BLOCKING.has(current.reason) ? current : null;
  const estimateProblem = current?.status === 'failed' && !refusal ? current : null;

  // ADR-052, "Video olarak": the part, muted, at the video's own size (never enlarged), through the ordinary download.
  const videoRecipe = useMemo(
    () => (asVideo && part ? gifVideoRecipe(state.project, part, state.settings) : null),
    [asVideo, part?.startUs, part?.endUs, state.project, state.settings], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const videoPlan = useMemo(() => {
    if (!videoRecipe) return null;
    const compiled = compileRenderPlan(videoRecipe, WEB_LOCAL_POLICY);
    return compiled.ok ? compiled.plan : null;
  }, [videoRecipe]);
  const videoExtras = useMemo(() => ({ overlayText: texts }), [texts]);
  const previewSize: GifSize = asVideo && videoPlan ? { width: videoPlan.width, height: videoPlan.height } : size;

  const onRange = useCallback((next: GifRange, wasCapped: boolean) => {
    setRange(next);
    setCapped(wasCapped);
  }, []);

  const lengthUs = part ? gifRangeLength(part) : 0;
  const mark = t('time.decimalMark');
  const estimateText = !part
    ? ''
    : asVideo
      ? lengthText(lengthUs, t)
      : current?.status === 'ready'
        ? fill(t('wizard.gif.estimate'), { length: lengthText(lengthUs, t), size: formatBytes(current.bytes, mark) })
        : fill(t('wizard.gif.measuring'), { length: lengthText(lengthUs, t) });

  const status = download.state;
  const ownDownload = asVideo
    ? undefined
    : {
        phase: status?.phase ?? null,
        busy: download.busy,
        readyTitle: t('wizard.gif.ready'),
        cancel: download.cancel,
        dismiss: download.dismiss,
        status: status ? (
          <GifStatus t={t} state={status} device={phone || touchScreen} onCancel={download.cancel} onShare={download.share} />
        ) : null,
      };
  const smallest = sizeChoices[0] ?? 'small';

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.gif.title"
      fileTag="gif"
      recipe={asVideo ? videoRecipe : null}
      exportExtras={asVideo ? videoExtras : undefined}
      downloadLabelKey="wizard.gif.downloadVideo"
      noEditor
      againSame
      ownDownload={ownDownload}
      preview={
        video && part ? (
          <GifPreview
            src={video.objectUrl}
            range={part}
            size={previewSize}
            texts={texts}
            onTexts={setTexts}
            measure={measure}
            disabled={download.busy}
            cover={asVideo}
          />
        ) : undefined
      }
      openVideo={async (file) => {
        download.dismiss();
        const outcome = await state.importVideo(file, ownSizeRecipe);
        if (outcome.kind !== 'opened') return false;
        setRange(initialGifRange(outcome.lengthUs));
        setCapped(false);
        // A new video: its sharpest size that fits is found again.
        setUserSize(null);
        return true;
      }}
    >
      {({ busy }) =>
        video && part ? (
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
                  data-state={asVideo ? 'video' : (current?.status ?? 'measuring')}
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

            {asVideo ? (
              videoPlan ? (
                <p className="wizard-hint" data-testid="gif-video-size" data-width={videoPlan.width} data-height={videoPlan.height}>
                  {fill(t('wizard.gif.videoSize'), { width: String(videoPlan.width), height: String(videoPlan.height) })}
                </p>
              ) : null
            ) : twoSizes ? (
              <fieldset
                className="gif-size"
                data-testid="gif-size"
                data-auto={userChose ? 'user' : picking ? 'picking' : 'picked'}
                data-auto-why={!userChose && auto.kind === 'chosen' ? auto.why : undefined}
                aria-describedby="gif-size-hint"
              >
                <legend>{t('wizard.gif.size')}</legend>
                {sizeChoices.map((id) => (
                  <label className="gif-size-option" data-checked={!picking && chosenSize === id} key={id}>
                    <input
                      type="radio"
                      name="gif-size"
                      value={id}
                      // While the sizes are still measured, none is checked: none is chosen yet.
                      checked={!picking && chosenSize === id}
                      disabled={busy}
                      onChange={() => setUserSize(id)}
                      data-testid={`gif-size-${id}`}
                    />
                    <span>{t(SIZE_LABEL[id])}</span>
                  </label>
                ))}
                {/*
                  The honest trade (ADR-046 addendum): a larger GIF looks sharper on a phone, and its file is larger. While
                  the size is chosen for the user (ADR-052), the same line says what is happening, then why this size: one
                  line, so that on a phone the choices below stay above the action bar.
                */}
                <p className="wizard-hint gif-size-hint" id="gif-size-hint" role="status" data-testid="gif-size-hint">
                  {picking && !refusal ? (
                    <span id="gif-size-picking" data-testid="gif-size-picking">
                      {t('wizard.gif.autoPicking')}
                    </span>
                  ) : !userChose && auto.kind === 'chosen' && auto.why === 'fits' ? (
                    <span data-testid="gif-size-picked">{t('wizard.gif.autoPicked')}</span>
                  ) : (
                    t('wizard.gif.sizeHint')
                  )}
                </p>
              </fieldset>
            ) : (
              <p className="wizard-hint" data-testid="gif-one-size">
                {t('wizard.gif.oneSize')}
              </p>
            )}

            {!asVideo && current?.status === 'ready' && gifIsLarge(current.bytes) ? (
              // Said, never blocked: the GIF is still made if the user wants it this large.
              <p className="wizard-blocked" role="status" data-testid="gif-too-large">
                {t(chosenSize === smallest ? 'wizard.gif.tooLargeSmallest' : 'wizard.gif.tooLarge')}
              </p>
            ) : null}

            {/* ADR-052: GIF (the card's own, the default) or the same part as a short video, the sharpest there is. Below
                the size, so that on a phone the size row stays where it was, above the action bar. */}
            <fieldset className="gif-size gif-output" data-testid="gif-output" aria-describedby="gif-output-hint">
              <legend>{t('wizard.gif.output')}</legend>
              {(['gif', 'video'] as const).map((id) => (
                <label className="gif-size-option" data-checked={output === id} key={id}>
                  <input
                    type="radio"
                    name="gif-output"
                    value={id}
                    checked={output === id}
                    disabled={busy}
                    onChange={() => setOutput(id)}
                    data-testid={`gif-output-${id}`}
                  />
                  <span>{t(id === 'gif' ? 'wizard.gif.outputGif' : 'wizard.gif.outputVideo')}</span>
                </label>
              ))}
              <p className="wizard-hint gif-size-hint" id="gif-output-hint" data-testid="gif-output-hint">
                {t(asVideo ? 'wizard.gif.videoNote' : 'wizard.gif.outputHint')}
              </p>
            </fieldset>

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

            {asVideo ? null : (
              <div className="wizard-actions wizard-action-bar" data-testid="wizard-actions">
                <button
                  type="button"
                  className="btn btn-accent wizard-go"
                  onClick={() => {
                    if (job) download.start(job, gifFileName(video.fileName));
                  }}
                  disabled={!job || busy || picking || refusal !== null || state.importing === 'video'}
                  aria-describedby={picking ? 'gif-size-picking' : undefined}
                  data-testid="wizard-download"
                >
                  <Icon name="download" />
                  {t('wizard.gif.download')}
                </button>
              </div>
            )}
          </>
        ) : null
      }
    </WizardFlow>
  );
}
