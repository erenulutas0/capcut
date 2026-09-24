'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { Icon } from '@/components/Icon';
import type { VideoCue } from '@/domain/captions';
import { formatPosition } from '@/domain/kesit';
import { formatSpokenTime, formatTimecode, US_PER_SECOND, type Micros } from '@/domain/time';
import {
  ZOOM_STEP,
  clampScroll,
  clampStripZoom,
  freezeScale,
  maxStripZoom,
  pointerToUs,
  scrollToShow,
  zoomAround,
  type EdgeTrimTarget,
  type FrozenScale,
  type StripView,
} from '@/domain/timelineEdit';
import type { TrimEdge } from '@/domain/trim';
import type { MessageKey } from '@/i18n/messages';
import { TrimHandle, type TrimCommitInfo, type TrimDragState } from './TrimHandle';

/** One kesit as the strip draws it. */
export interface StripKesit {
  clipId: string;
  /** 0-based place in the list; shown as its number (index + 1). */
  index: number;
  inUs: Micros;
  outUs: Micros;
}

/** The range whose edges the strip's handles move: the pending marks, or the selected kesit. */
export interface EditableRange {
  kind: 'pending' | 'kesit';
  inUs: Micros;
  outUs: Micros;
  /** Accessible names of the two handles. */
  startLabel: string;
  endLabel: string;
}

interface Props {
  t: (key: MessageKey) => string;
  durationUs: Micros;
  timeUs: Micros;
  /** One output frame; the arrow-key step. */
  frameUs: Micros;
  kesitler: StripKesit[];
  selectedClipId: string | null;
  /** The kesit whose ▶ is playing, drawn brighter. */
  playingClipId: string | null;
  /** The Başlangıç/Bitiş range being marked (unmarked edges filled in), or null. */
  pending: { inUs: Micros; outUs: Micros } | null;
  editable: EditableRange | null;
  resolveEdge: (edge: TrimEdge, rawUs: number) => EdgeTrimTarget | null;
  captionMarks: VideoCue[];
  disabled: boolean;
  onSeek: (us: Micros) => void;
  onSelectKesit: (clipId: string) => void;
  onEdgeStart: () => void;
  onEdgePreview: (edge: TrimEdge, us: Micros) => void;
  onEdgeCancel: () => void;
  onEdgeCommit: (edge: TrimEdge, us: Micros, info: TrimCommitInfo) => void;
}

const HINT_ID = 'strip-hint';
const EDGE_HINT_ID = 'strip-edge-hint';

/** Tick spacing candidates, in seconds; the first that leaves ~90 px between labels wins. */
const TICK_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const MIN_TICK_PX = 90;

interface ScrubSession {
  pointerId: number;
  scale: FrozenScale;
  touch: boolean;
  startX: number;
  moved: boolean;
}

/**
 * The video strip (ADR-026): the WHOLE source video on its own clock, with the
 * kesitler as numbered coloured regions, the range being marked, and the one
 * playhead. It zooms (buttons, Ctrl/⌘+wheel, pinch) and scrolls sideways,
 * and keeps the playhead in view.
 *
 * - Mouse/pen: press and drag to scrub. Touch: a tap seeks, a one-finger
 *   swipe scrolls the zoomed strip, two fingers pinch to zoom.
 * - The playhead is a slider: arrows move one frame, Shift one second,
 *   Home/End jump to the ends.
 * - The handles move the edges of the range being marked or of the selected
 *   kesit (drag, or arrow keys on the handle).
 */
export function SourceStrip({
  t,
  durationUs,
  timeUs,
  frameUs,
  kesitler,
  selectedClipId,
  playingClipId,
  pending,
  editable,
  resolveEdge,
  captionMarks,
  disabled,
  onSeek,
  onSelectKesit,
  onEdgeStart,
  onEdgePreview,
  onEdgeCancel,
  onEdgeCommit,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportPx, setViewportPx] = useState(0);
  const [view, setView] = useState<StripView>({ zoom: 1, scrollPx: 0 });
  const viewRef = useRef(view);
  const scrubRef = useRef<ScrubSession | null>(null);
  const [drag, setDrag] = useState<TrimDragState | null>(null);
  const safeDuration = Math.max(1, durationUs);
  const playheadUs = Math.max(0, Math.min(timeUs, durationUs));
  const maxZoom = maxStripZoom(durationUs);

  const spoken = (us: Micros) =>
    formatSpokenTime(us, { minute: t('time.minute'), second: t('time.second'), decimalMark: t('time.decimalMark') });
  const pct = (us: Micros) => `${(Math.max(0, Math.min(us, durationUs)) / safeDuration) * 100}%`;

  // ---------------------------------------------------------- the view

  const applyView = useCallback((next: StripView) => {
    viewRef.current = next;
    setView(next);
    const element = viewportRef.current;
    if (element && Math.abs(element.scrollLeft - next.scrollPx) > 0.5) {
      // The content width changes with the zoom in the same frame; scroll
      // after React has laid it out.
      window.requestAnimationFrame(() => {
        if (viewportRef.current) viewportRef.current.scrollLeft = viewRef.current.scrollPx;
      });
    }
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const measure = () => setViewportPx(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A new (or shorter) video: never zoomed further than it allows.
  useEffect(() => {
    const current = viewRef.current;
    const zoom = clampStripZoom(current.zoom, durationUs);
    if (zoom !== current.zoom) applyView({ zoom, scrollPx: clampScroll(current.scrollPx, zoom, viewportPx) });
  }, [applyView, durationUs, viewportPx]);

  // The playhead stays in view: while playing, after a seek, after a zoom.
  useEffect(() => {
    if (scrubRef.current) return;
    const current = viewRef.current;
    const scrollPx = scrollToShow(playheadUs, durationUs, current, viewportPx);
    if (scrollPx !== current.scrollPx) applyView({ ...current, scrollPx });
  }, [applyView, durationUs, playheadUs, viewportPx]);

  const zoomBy = useCallback(
    (factor: number, anchorPx?: number) => {
      const current = viewRef.current;
      const playheadPx = (playheadUs / safeDuration) * viewportPx * current.zoom - current.scrollPx;
      const anchor = anchorPx ?? Math.max(0, Math.min(viewportPx, playheadPx));
      applyView(zoomAround(current, factor, anchor, viewportPx, durationUs));
    },
    [applyView, durationUs, playheadUs, safeDuration, viewportPx],
  );

  // Ctrl/⌘ + wheel zooms around the pointer; needs a non-passive listener.
  // Two fingers pinch-zoom around their middle (touch events: the strip lets
  // the browser scroll it sideways with one finger).
  const zoomByRef = useRef(zoomBy);
  useEffect(() => {
    zoomByRef.current = zoomBy;
  }, [zoomBy]);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomByRef.current(Math.exp(-event.deltaY * 0.002), event.clientX - rect.left);
    };
    let pinch: { distance: number; view: StripView } | null = null;
    const distanceOf = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinch = { distance: distanceOf(event.touches), view: viewRef.current };
        scrubRef.current = null;
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const a = event.touches[0];
      const b = event.touches[1];
      if (!a || !b || pinch.distance <= 0) return;
      const rect = element.getBoundingClientRect();
      const middle = (a.clientX + b.clientX) / 2 - rect.left;
      const factor = distanceOf(event.touches) / pinch.distance;
      const width = element.clientWidth;
      const next = zoomAround(pinch.view, factor, middle, width, durationUs);
      viewRef.current = next;
      setView(next);
      element.scrollLeft = next.scrollPx;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [durationUs]);

  const onScroll = () => {
    const element = viewportRef.current;
    if (!element) return;
    const current = viewRef.current;
    if (Math.abs(element.scrollLeft - current.scrollPx) < 0.5) return;
    const next = { ...current, scrollPx: element.scrollLeft };
    viewRef.current = next;
    setView(next);
  };

  // ---------------------------------------------------------- scrubbing

  const scaleNow = (element: HTMLElement): FrozenScale => {
    const rect = element.getBoundingClientRect();
    return freezeScale(rect.left, rect.width, safeDuration);
  };

  const onContentPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || durationUs <= 0) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const touch = event.pointerType === 'touch';
    const session: ScrubSession = {
      pointerId: event.pointerId,
      scale: scaleNow(event.currentTarget),
      touch,
      startX: event.clientX,
      moved: false,
    };
    scrubRef.current = session;
    if (touch) return; // a tap seeks on release; a swipe scrolls
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(pointerToUs(session.scale, event.clientX, Math.max(0, durationUs - 1)));
  };

  const onContentPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = scrubRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - session.startX) > 6) session.moved = true;
    if (session.touch) return;
    onSeek(pointerToUs(session.scale, event.clientX, Math.max(0, durationUs - 1)));
  };

  const endScrub = (event: PointerEvent<HTMLDivElement>, canceled: boolean) => {
    const session = scrubRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (session.touch && !canceled && !session.moved) {
      onSeek(pointerToUs(scaleNow(event.currentTarget), event.clientX, Math.max(0, durationUs - 1)));
    }
  };

  const onPlayheadKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? US_PER_SECOND : frameUs;
    const last = Math.max(0, durationUs - 1);
    let next: Micros;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = playheadUs - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = playheadUs + step;
        break;
      case 'PageDown':
        next = playheadUs - 10 * US_PER_SECOND;
        break;
      case 'PageUp':
        next = playheadUs + 10 * US_PER_SECOND;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    onSeek(Math.max(0, Math.min(last, Math.round(next))));
  };

  // ---------------------------------------------------------- drawing

  const contentPx = viewportPx * view.zoom;
  const ticks: Micros[] = [];
  if (contentPx > 0 && durationUs > 0) {
    const pxPerSecond = contentPx / (durationUs / US_PER_SECOND);
    const stepS = TICK_STEPS_S.find((step) => step * pxPerSecond >= MIN_TICK_PX) ?? 3600;
    const stepUs = stepS * US_PER_SECOND;
    // Only the visible stretch (plus one step each side) is drawn.
    const fromUs = Math.max(0, ((view.scrollPx - MIN_TICK_PX) / contentPx) * durationUs);
    const toUs = Math.min(durationUs, ((view.scrollPx + viewportPx + MIN_TICK_PX) / contentPx) * durationUs);
    for (let us = Math.ceil(fromUs / stepUs) * stepUs; us <= toUs; us += stepUs) ticks.push(us);
  }

  const ghost = (() => {
    if (!drag || !editable) return null;
    const from = Math.min(drag.startUs, drag.valueUs);
    const to = Math.max(drag.startUs, drag.valueUs);
    if (to <= from) return null;
    const removes = drag.edge === 'in' ? drag.valueUs > drag.startUs : drag.valueUs < drag.startUs;
    return (
      <span
        className="vstrip-ghost"
        data-kind={removes ? 'remove' : 'add'}
        style={{ left: pct(from), width: `${((to - from) / safeDuration) * 100}%` }}
        aria-hidden="true"
        data-testid="trim-ghost"
      />
    );
  })();

  const handle = (edge: TrimEdge) => {
    if (!editable) return null;
    const valueUs = edge === 'in' ? editable.inUs : editable.outUs;
    const low = resolveEdge(edge, Number.NEGATIVE_INFINITY);
    const high = resolveEdge(edge, Number.POSITIVE_INFINITY);
    return (
      <div className="vstrip-handle-slot" data-edge={edge} style={{ left: pct(valueUs) }}>
        <TrimHandle
          t={t}
          edge={edge}
          label={edge === 'in' ? editable.startLabel : editable.endLabel}
          valueUs={valueUs}
          otherEdgeUs={edge === 'in' ? editable.outUs : editable.inUs}
          minUs={low?.valueUs ?? 0}
          maxUs={high?.valueUs ?? durationUs}
          frameUs={frameUs}
          referenceUs={safeDuration}
          describedBy={EDGE_HINT_ID}
          resolve={(rawUs) => resolveEdge(edge, rawUs)}
          onStart={onEdgeStart}
          onPreview={onEdgePreview}
          onDrag={setDrag}
          onCancel={onEdgeCancel}
          onCommit={(us, info) => onEdgeCommit(edge, us, info)}
        />
      </div>
    );
  };

  return (
    <section className="vstrip" aria-label={t('strip.title')} data-testid="source-strip">
      <div className="vstrip-head">
        <h2 className="vstrip-title">{t('strip.title')}</h2>
        <span className="vstrip-now" aria-hidden="true">
          {formatTimecode(playheadUs)}
        </span>
        <div className="vstrip-zoom" role="group" aria-label={t('strip.zoomGroup')}>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            disabled={disabled || view.zoom <= 1}
            aria-label={t('strip.zoomOut')}
            data-testid="strip-zoom-out"
          >
            <Icon name="minus" size={16} />
          </button>
          <span className="vstrip-zoom-value" data-testid="strip-zoom-value">
            <span className="visually-hidden">{t('strip.zoomValue')} </span>
            {`×${view.zoom < 10 ? view.zoom.toFixed(1).replace(/\.0$/, '') : Math.round(view.zoom)}`}
          </span>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => zoomBy(ZOOM_STEP)}
            disabled={disabled || view.zoom >= maxZoom}
            aria-label={t('strip.zoomIn')}
            data-testid="strip-zoom-in"
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            type="button"
            className="btn btn-compact"
            onClick={() => applyView({ zoom: 1, scrollPx: 0 })}
            disabled={disabled || view.zoom <= 1}
            data-testid="strip-zoom-fit"
          >
            {t('strip.zoomFit')}
          </button>
        </div>
      </div>

      <div className="vstrip-viewport" ref={viewportRef} onScroll={onScroll} data-testid="strip-viewport">
        <div
          className="vstrip-content tl-lane"
          style={{ width: `${view.zoom * 100}%` }}
          data-disabled={disabled}
          onPointerDown={onContentPointerDown}
          onPointerMove={onContentPointerMove}
          onPointerUp={(event) => endScrub(event, false)}
          onPointerCancel={(event) => endScrub(event, true)}
          data-testid="strip-content"
        >
          <div className="vstrip-ruler" aria-hidden="true">
            {ticks.map((us) => (
              <span key={us} className="vstrip-tick" style={{ left: pct(us) }}>
                <span className="vstrip-tick-label">{formatPosition(us)}</span>
              </span>
            ))}
          </div>

          <div className="vstrip-track">
            {kesitler.map((kesit) => (
              <div
                key={kesit.clipId}
                className="vstrip-kesit"
                data-color={kesit.index % 6}
                data-selected={kesit.clipId === selectedClipId}
                data-playing={kesit.clipId === playingClipId}
                style={{ left: pct(kesit.inUs), width: pct(kesit.outUs - kesit.inUs) }}
                data-testid="strip-kesit"
                data-clip-id={kesit.clipId}
              >
                {/* Pointer shortcut only: the kesit list is the accessible way to select. */}
                <button
                  type="button"
                  className="vstrip-kesit-chip"
                  tabIndex={-1}
                  aria-hidden="true"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onSelectKesit(kesit.clipId)}
                  title={`${formatPosition(kesit.inUs)} → ${formatPosition(kesit.outUs)}`}
                >
                  {kesit.index + 1}
                </button>
              </div>
            ))}
            {pending ? (
              <div
                className="vstrip-pending"
                style={{ left: pct(pending.inUs), width: pct(pending.outUs - pending.inUs) }}
                aria-hidden="true"
                data-testid="strip-pending"
              />
            ) : null}
            {ghost}
            {handle('in')}
            {handle('out')}
          </div>

          {captionMarks.length > 0 ? (
            <div className="vstrip-captions" aria-hidden="true" data-testid="strip-captions">
              {captionMarks.map((mark) => (
                <span
                  key={`${mark.cueId}-${mark.startUs}`}
                  className="vstrip-caption-mark"
                  style={{ left: pct(mark.startUs), width: pct(mark.endUs - mark.startUs) }}
                  title={`${formatTimecode(mark.startUs)} → ${formatTimecode(mark.endUs)} · ${mark.text}`}
                  data-testid="strip-caption-mark"
                />
              ))}
            </div>
          ) : null}

          <div
            role="slider"
            tabIndex={disabled ? -1 : 0}
            className="vstrip-playhead"
            style={{ left: pct(playheadUs) }}
            aria-label={t('strip.playhead')}
            aria-orientation="horizontal"
            aria-disabled={disabled}
            aria-valuemin={0}
            aria-valuemax={durationUs / US_PER_SECOND}
            aria-valuenow={playheadUs / US_PER_SECOND}
            aria-valuetext={t('strip.playheadValue')
              .replace('{now}', spoken(playheadUs))
              .replace('{total}', spoken(durationUs))}
            aria-describedby={HINT_ID}
            onKeyDown={onPlayheadKeyDown}
            data-testid="timeline-playhead"
          >
            <span className="vstrip-playhead-knob" aria-hidden="true" />
            <span className="vstrip-playhead-line" aria-hidden="true" />
          </div>
        </div>
      </div>
      <p id={HINT_ID} className="visually-hidden">
        {t('strip.hint')}
      </p>
      <p id={EDGE_HINT_ID} className="visually-hidden">
        {t('strip.edgeHint')}
      </p>
    </section>
  );
}
