'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

import { Icon } from '@/components/Icon';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import { aspectRatioValue, type CaptionStyleV2, type Project, type ViewRectV1 } from '@/domain/edl';
import { formatDurationShort, formatTimecode, US_PER_SECOND, type Micros } from '@/domain/time';
import { placeView } from '@/domain/transform';
import type { MessageKey } from '@/i18n/messages';
import { CaptionOverlay } from './CaptionOverlay';

interface Props {
  t: (key: MessageKey) => string;
  project: Project;
  video: MediaHandle | null;
  /** The frame crop every download uses (the first kesit's, or the settings'). */
  view: ViewRectV1;
  videoRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  playbackError: boolean;
  timeUs: Micros;
  onTogglePlay: () => void;
  onSeek: (us: Micros) => void;
  onPickVideo: () => void;
  importing: boolean;
  /** Active caption line at the playhead; null when nothing is drawn. */
  caption: { cueId: string; text: string } | null;
  captionStyle: CaptionStyleV2;
  /** Shown under the transport, e.g. when the caption font failed to load. */
  captionNotice?: React.ReactNode;
  /** Bumped by the F key: toggles full screen. */
  fullscreenRequest: number;
  children?: React.ReactNode;
}

/** Keeps the frame at the exact canvas aspect inside whatever space is free. */
function useFrameBox(containerRef: RefObject<HTMLDivElement | null>, aspect: number, inset: number) {
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const available = { width: Math.max(0, rect.width - inset), height: Math.max(0, rect.height - inset) };
      let width = available.width;
      let height = width / aspect;
      if (height > available.height) {
        height = available.height;
        width = height * aspect;
      }
      setBox({ width: Math.round(width), height: Math.round(height) });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, aspect, inset]);

  return box;
}

/** Element full screen exists (desktop browsers, Android); iPhone Safari has none. */
function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

const noSubscription = () => () => undefined;

/**
 * The preview: the video on its own clock, drawn with the frame crop and the
 * caption overlay exactly as the downloads will have them (ADR-026).
 *
 * ⛶ (or F) shows the same element full screen — the Fullscreen API on the
 * preview container, so the crop and the captions stay what will be
 * exported — with its own simple controls: play/pause, time, a seek bar and
 * a button to leave; Escape leaves too. Where the browser has no element full
 * screen (iPhone Safari) the button is not shown.
 */
export function PreviewStage({
  t,
  project,
  video,
  view,
  videoRef,
  playing,
  playbackError,
  timeUs,
  onTogglePlay,
  onSeek,
  onPickVideo,
  importing,
  caption,
  captionStyle,
  captionNotice,
  fullscreenRequest,
  children,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = useSyncExternalStore(noSubscription, fullscreenSupported, () => false);
  const aspect = aspectRatioValue(project.canvas.aspect);
  const box = useFrameBox(wrapRef, aspect, fullscreen ? 0 : 16);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current && wrapRef.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = wrapRef.current;
    if (!element || !fullscreenSupported()) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void element.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // The F key (EditorApp) asks by bumping a counter.
  const lastRequest = useRef(fullscreenRequest);
  useEffect(() => {
    if (fullscreenRequest === lastRequest.current) return;
    lastRequest.current = fullscreenRequest;
    if (video) toggleFullscreen();
  }, [fullscreenRequest, toggleFullscreen, video]);

  const placement = placeView(view, video?.displayWidth ?? 0, video?.displayHeight ?? 0, box.width, box.height);
  const durationUs = video?.durationUs ?? 0;
  const currentUs = Math.min(timeUs, durationUs);
  const percent = durationUs > 0 ? Math.min(100, (currentUs / durationUs) * 100) : 0;

  const seekBar = (id: string) => (
    <input
      id={id}
      className="fs-seek-input"
      type="range"
      min={0}
      max={Math.max(1, Math.round(durationUs / 1000))}
      step={1}
      value={Math.round(currentUs / 1000)}
      disabled={!video || durationUs === 0}
      aria-label={t('preview.seekLabel')}
      aria-valuetext={`${formatTimecode(currentUs)} / ${formatTimecode(durationUs)}`}
      style={{ ['--range-pct' as string]: `${percent}%` }}
      onChange={(event) => onSeek(Number(event.target.value) * 1000)}
      data-testid="fullscreen-seek"
    />
  );

  return (
    <section className="stage" aria-label={t('a11y.preview')}>
      <div className="frame-wrap" ref={wrapRef} data-fullscreen={fullscreen} data-testid="preview-wrap">
        {video ? (
          <div
            className="frame"
            style={{ width: box.width, height: box.height, background: project.canvas.background }}
            data-testid="preview-frame"
            data-aspect={project.canvas.aspect}
          >
            <video
              ref={videoRef}
              src={video.objectUrl}
              playsInline
              preload="metadata"
              // No native controls (the transport drives it), so the element
              // needs its own name to be more than "video".
              aria-label={t('a11y.previewVideo')}
              style={{
                width: placement.width,
                height: placement.height,
                left: placement.left,
                top: placement.top,
              }}
              data-testid="preview-video"
            />
            <CaptionOverlay
              text={caption?.text ?? null}
              cueId={caption?.cueId ?? null}
              style={captionStyle}
              aspect={project.canvas.aspect}
              width={box.width}
              height={box.height}
            />
          </div>
        ) : (
          <div className="frame-empty">
            <Icon name="film" size={30} />
            <h2>{importing ? t('preview.importing') : t('preview.emptyTitle')}</h2>
            <p>{t('preview.emptyBody')}</p>
            <button type="button" className="btn btn-accent" onClick={onPickVideo} data-testid="pick-video">
              <Icon name="folder" />
              {t('preview.pickVideo')}
            </button>
          </div>
        )}

        {video && canFullscreen && !fullscreen ? (
          <button
            type="button"
            className="icon-btn frame-fullscreen"
            onClick={toggleFullscreen}
            aria-label={t('preview.fullscreen')}
            aria-keyshortcuts="F"
            data-testid="fullscreen-toggle"
          >
            <Icon name="fullscreen" size={18} />
          </button>
        ) : null}

        {fullscreen && video ? (
          <div className="fs-controls" data-testid="fullscreen-controls">
            <button
              type="button"
              className="play-btn"
              onClick={onTogglePlay}
              aria-label={playing ? t('preview.pause') : t('preview.play')}
              data-testid="fullscreen-play"
            >
              <Icon name={playing ? 'pause' : 'play'} size={22} />
            </button>
            <span className="fs-time" data-testid="fullscreen-time">
              {formatTimecode(currentUs)} / {formatTimecode(durationUs)}
            </span>
            <div className="fs-seek">{seekBar('fs-seek')}</div>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleFullscreen}
              aria-label={t('preview.exitFullscreen')}
              data-testid="fullscreen-exit"
            >
              <Icon name="exitFullscreen" size={18} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="transport">
        <button
          type="button"
          className="play-btn"
          onClick={onTogglePlay}
          disabled={!video}
          aria-label={playing ? t('preview.pause') : t('preview.play')}
          aria-keyshortcuts="Space"
          data-testid="play-toggle"
        >
          <Icon name={playing ? 'pause' : 'play'} size={22} />
        </button>
        {/* Hidden words make the readouts more than bare numbers. Not live:
            during playback they change every frame. */}
        <span className="time-readout" data-testid="time-now">
          <span className="visually-hidden">{`${t('a11y.timeNow')} `}</span>
          <strong data-testid="current-time">{formatTimecode(currentUs)}</strong>
          <span aria-hidden="true"> / </span>
          <span className="visually-hidden">{` ${t('a11y.timeTotal')} `}</span>
          <span data-testid="total-time">{formatTimecode(durationUs)}</span>
        </span>
        <span className="stage-meta" data-testid="source-meta">
          {video ? `${safeFileName(video.fileName, 40)} · ${formatDurationShort(video.durationUs)}` : t('sources.none')}
        </span>
      </div>

      {playbackError ? (
        <p className="inline-error" role="status">
          <Icon name="alert" />
          {t('error.unsupported_preview')}
        </p>
      ) : null}

      {captionNotice}

      {children}

      <span className="visually-hidden" data-testid="source-time-us">
        {Math.round(timeUs / (US_PER_SECOND / 1000))}
      </span>
    </section>
  );
}
