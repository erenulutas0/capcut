'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { Icon } from '@/components/Icon';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import { aspectRatioValue, type CaptionStyleV2, type Project } from '@/domain/edl';
import { formatDurationShort, formatTimecode, US_PER_SECOND, type Micros } from '@/domain/time';
import { placeView } from '@/domain/transform';
import type { MessageKey } from '@/i18n/messages';
import { CaptionOverlay } from './CaptionOverlay';
import { onTablistKeyDown } from './tablist';
import type { PreviewMode } from './useEditorState';

interface Props {
  t: (key: MessageKey) => string;
  project: Project;
  video: MediaHandle | null;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  playbackError: boolean;
  sourceTimeUs: Micros;
  outputTimeUs: Micros;
  outputDurationUs: Micros;
  onTogglePlay: () => void;
  onSeekSource: (us: Micros) => void;
  onSeekOutput: (us: Micros) => void;
  onPickVideo: () => void;
  importing: boolean;
  /** Active caption line at the output playhead; null when nothing is drawn. */
  caption: { cueId: string; text: string } | null;
  captionStyle: CaptionStyleV2;
  /** Shown under the transport, e.g. when the caption font failed to load. */
  captionNotice?: React.ReactNode;
  children: React.ReactNode;
}

/** Keeps the frame at the exact canvas aspect inside whatever space is free. */
function useFrameBox(containerRef: RefObject<HTMLDivElement | null>, aspect: number) {
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const available = { width: Math.max(0, rect.width - 16), height: Math.max(0, rect.height - 16) };
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
  }, [containerRef, aspect]);

  return box;
}

export function PreviewStage({
  t,
  project,
  video,
  mode,
  onModeChange,
  videoRef,
  playing,
  playbackError,
  sourceTimeUs,
  outputTimeUs,
  outputDurationUs,
  onTogglePlay,
  onSeekSource,
  onSeekOutput,
  onPickVideo,
  importing,
  caption,
  captionStyle,
  captionNotice,
  children,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const aspect = aspectRatioValue(project.canvas.aspect);
  const box = useFrameBox(wrapRef, aspect);

  const view = project.clips[0]?.view ?? { x: 0, y: 0, width: 1, height: 1, fit: 'cover' as const };
  const placement = placeView(
    view,
    video?.displayWidth ?? 0,
    video?.displayHeight ?? 0,
    box.width,
    box.height,
  );

  const isOutput = mode === 'output';
  const durationUs = isOutput ? outputDurationUs : (video?.durationUs ?? 0);
  const currentUs = isOutput ? outputTimeUs : sourceTimeUs;
  const percent = durationUs > 0 ? Math.min(100, (currentUs / durationUs) * 100) : 0;

  return (
    <section className="stage" aria-label={t('a11y.preview')}>
      <div className="stage-head">
        <div
          className="mode-switch"
          role="tablist"
          aria-label={t('a11y.previewMode')}
          onKeyDown={onTablistKeyDown}
        >
          <button
            type="button"
            role="tab"
            aria-selected={!isOutput}
            // Stays the Tab stop whenever the result tab cannot take focus.
            tabIndex={isOutput && project.clips.length > 0 ? -1 : 0}
            onClick={() => onModeChange('source')}
          >
            {t('preview.source')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isOutput}
            tabIndex={isOutput ? 0 : -1}
            onClick={() => onModeChange('output')}
            disabled={project.clips.length === 0}
          >
            {t('preview.output')}
          </button>
        </div>
        <p className="stage-meta" data-testid="source-meta">
          {video
            ? `${safeFileName(video.fileName, 40)} · ${formatDurationShort(video.durationUs)}`
            : t('sources.none')}
        </p>
      </div>

      <div className="frame-wrap" ref={wrapRef}>
        {video ? (
          <div
            className="frame"
            style={{ width: box.width, height: box.height, background: project.canvas.background }}
            data-testid="preview-frame"
            data-aspect={project.canvas.aspect}
          >
            <span className="frame-badge">
              {isOutput ? t('preview.outputBadge') : t('preview.sourceBadge')}
            </span>
            <video
              ref={videoRef}
              src={video.objectUrl}
              playsInline
              preload="metadata"
              // No native controls (the transport below drives it), so the
              // element needs its own name to be more than "video".
              aria-label={t('a11y.previewVideo')}
              style={{
                width: placement.width,
                height: placement.height,
                left: placement.left,
                top: placement.top,
              }}
              data-testid="preview-video"
            />
            {/* Captions live on the output timeline, so only the result
                preview carries the overlay. */}
            {isOutput ? (
              <CaptionOverlay
                text={caption?.text ?? null}
                cueId={caption?.cueId ?? null}
                style={captionStyle}
                aspect={project.canvas.aspect}
                width={box.width}
                height={box.height}
              />
            ) : null}
          </div>
        ) : (
          <div className="frame-empty">
            <Icon name="film" size={30} />
            <h2>{importing ? t('preview.importing') : t('preview.emptyTitle')}</h2>
            <p>{t('preview.emptyBody')}</p>
            <button type="button" className="btn btn-accent" onClick={onPickVideo}>
              <Icon name="folder" />
              {t('preview.pickVideo')}
            </button>
          </div>
        )}
      </div>

      <div className="transport">
        {/* Hidden words make the readouts more than bare numbers. Not live:
            during playback they change every frame. */}
        <span className="time-readout" data-testid="time-now">
          <span className="visually-hidden">{`${t('a11y.timeNow')} `}</span>
          <strong data-testid="current-time">{formatTimecode(currentUs)}</strong>
        </span>
        <button
          type="button"
          className="play-btn"
          onClick={onTogglePlay}
          disabled={!video || (isOutput && outputDurationUs === 0)}
          aria-label={playing ? t('preview.pause') : t('preview.play')}
          data-testid="play-toggle"
        >
          <Icon name={playing ? 'pause' : 'play'} size={22} />
        </button>
        <span className="time-readout" data-testid="time-total">
          <span className="visually-hidden">{`${t('a11y.timeTotal')} `}</span>
          <span data-testid="total-time">{formatTimecode(durationUs)}</span>
        </span>
      </div>

      <div className="scrub-row">
        <span className="scrub-label">
          {isOutput ? t('preview.outputTime') : t('preview.sourceTime')}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(durationUs / 1000))}
          step={1}
          value={Math.round(currentUs / 1000)}
          disabled={!video || durationUs === 0}
          aria-label={t('preview.seekLabel')}
          style={{ ['--range-pct' as string]: `${percent}%` }}
          onChange={(event) => {
            const us = Number(event.target.value) * 1000;
            if (isOutput) onSeekOutput(us);
            else onSeekSource(us);
          }}
        />
      </div>

      {playbackError ? (
        <p className="inline-error" role="status">
          <Icon name="alert" />
          {t('error.unsupported_preview')}
        </p>
      ) : null}

      {isOutput ? (
        <p className="hint-small" data-testid="output-note">
          {t('preview.outputNote')}
        </p>
      ) : null}

      {captionNotice}

      {children}

      <span className="visually-hidden" data-testid="output-duration-us">
        {outputDurationUs}
      </span>
      <span className="visually-hidden" data-testid="source-time-us">
        {Math.round(sourceTimeUs / (US_PER_SECOND / 1000))}
      </span>
    </section>
  );
}
