'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { formatLength, formatSpokenTime, US_PER_SECOND, type Micros } from '@/domain/time';
import { freezeScale, type EdgeTrimTarget } from '@/domain/timelineEdit';
import type { TrimEdge } from '@/domain/trim';
import type { MessageKey } from '@/i18n/messages';

export interface TrimCommitInfo {
  /** Fold into the undo step on top (a held arrow key). */
  coalesce: boolean;
  /** A pointer drag (announced) rather than a key step (the slider speaks). */
  pointer: boolean;
  /** The drag wanted a shorter piece than allowed and stopped at the minimum. */
  heldAtMinimum: boolean;
}

/** What the timeline needs to draw the ghost of a drag in progress. */
export interface TrimDragState {
  edge: TrimEdge;
  startUs: Micros;
  valueUs: Micros;
  /** Frozen at pointer-down, like the handle's own movement. */
  usPerPx: number;
}

interface Props {
  t: (key: MessageKey) => string;
  edge: TrimEdge;
  /** Accessible name, e.g. "Parça 02 başlangıcı". */
  label: string;
  valueUs: Micros;
  /** The piece's other edge, for the live length readout. */
  otherEdgeUs: Micros;
  minUs: Micros;
  maxUs: Micros;
  /** One output frame; the arrow-key step. */
  frameUs: Micros;
  /** Output length the track width stands for; frozen when a drag starts. */
  referenceUs: Micros;
  describedBy: string;
  /** Raw wish -> legal, snapped value (domain `resolveEdgeTrim`). */
  resolve: (rawUs: number) => EdgeTrimTarget | null;
  onStart: () => void;
  onPreview: (edge: TrimEdge, us: Micros) => void;
  onDrag: (state: TrimDragState | null) => void;
  onCancel: () => void;
  onCommit: (us: Micros, info: TrimCommitInfo) => void;
}

interface DragSession {
  pointerId: number;
  startX: number;
  usPerPx: number;
  startUs: Micros;
  valueUs: Micros;
  heldAtMinimum: boolean;
}

const SECOND_STEP_US = US_PER_SECOND;

/**
 * One edge of the selected piece on the timeline.
 *
 * Pointer Events with pointer capture cover mouse, touch and pen with one code
 * path. The scale (µs per pixel) is frozen when the pointer goes down, and the
 * recipe changes once, on release: a drag is one undo step, the timeline does
 * not re-layout under the finger, and autosave does not write thirty
 * intermediate states. It is also a real slider for keyboard and screen-reader
 * users.
 */
export function TrimHandle({
  t,
  edge,
  label,
  valueUs,
  otherEdgeUs,
  minUs,
  maxUs,
  frameUs,
  referenceUs,
  describedBy,
  resolve,
  onStart,
  onPreview,
  onDrag,
  onCancel,
  onCommit,
}: Props) {
  // The session lives in a ref because pointer events can arrive faster than
  // React re-renders; `live` only mirrors it for drawing.
  const sessionRef = useRef<DragSession | null>(null);
  // True after a key press on this handle, until focus leaves: auto-repeated
  // presses of the same run fold into that press's undo step.
  const keyRunRef = useRef(false);
  const [live, setLive] = useState<{ valueUs: Micros; offsetPx: number; startUs: Micros } | null>(
    null,
  );

  const shownUs = live?.valueUs ?? valueUs;
  const words = {
    minute: t('time.minuteShort'),
    second: t('time.secondShort'),
    decimalMark: t('time.decimalMark'),
  };
  const lengthOf = (us: Micros) => Math.abs(otherEdgeUs - us);
  const startLengthUs = lengthOf(live?.startUs ?? valueUs);
  const shownLengthUs = lengthOf(shownUs);
  const deltaUs = shownLengthUs - startLengthUs;
  const deltaText =
    live && deltaUs !== 0 ? ` (${deltaUs > 0 ? '+' : '−'}${formatLength(Math.abs(deltaUs), words)})` : '';

  const spoken = (us: Micros) =>
    formatSpokenTime(us, {
      minute: t('time.minute'),
      second: t('time.second'),
      decimalMark: t('time.decimalMark'),
    });

  const finish = () => {
    sessionRef.current = null;
    setLive(null);
    onDrag(null);
  };

  const cancel = (element: HTMLElement) => {
    const session = sessionRef.current;
    if (!session) return;
    if (element.hasPointerCapture(session.pointerId)) {
      element.releasePointerCapture(session.pointerId);
    }
    finish();
    onCancel();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // The timeline behind the handle seeks on pointer-down; a trim must not.
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (sessionRef.current) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.focus();
    element.setPointerCapture(event.pointerId);

    const track = element.closest('.tl-lane');
    const rect = track?.getBoundingClientRect();
    // Frozen for the whole drag: nothing the layout does in reaction to the
    // drag (labels, ghost) can feed back into the value under the pointer.
    const { usPerPx } = freezeScale(rect?.left ?? 0, rect?.width ?? 0, referenceUs);

    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      usPerPx,
      startUs: valueUs,
      valueUs,
      heldAtMinimum: false,
    };
    keyRunRef.current = false;
    setLive({ valueUs, offsetPx: 0, startUs: valueUs });
    onStart();
    onPreview(edge, valueUs);
    onDrag({ edge, startUs: valueUs, valueUs, usPerPx });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const raw = session.startUs + (event.clientX - session.startX) * session.usPerPx;
    const next = resolve(raw);
    if (next === null) return;
    session.heldAtMinimum = next.heldAtMinimum;
    if (next.valueUs === session.valueUs) return;
    session.valueUs = next.valueUs;
    setLive({
      valueUs: next.valueUs,
      offsetPx: (next.valueUs - session.startUs) / session.usPerPx,
      startUs: session.startUs,
    });
    onPreview(edge, next.valueUs);
    onDrag({ edge, startUs: session.startUs, valueUs: next.valueUs, usPerPx: session.usPerPx });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    finish();
    if (session.valueUs !== session.startUs) {
      onCommit(session.valueUs, { coalesce: false, pointer: true, heldAtMinimum: session.heldAtMinimum });
    } else {
      // Nothing changed: hand the clock back exactly as a cancel would.
      onCancel();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (sessionRef.current) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel(event.currentTarget);
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const step = event.shiftKey ? SECOND_STEP_US : frameUs;
    let raw: number;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        raw = valueUs - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        raw = valueUs + step;
        break;
      case 'Home':
        raw = Number.NEGATIVE_INFINITY;
        break;
      case 'End':
        raw = Number.POSITIVE_INFINITY;
        break;
      default:
        return;
    }
    event.preventDefault();
    // The arrows belong to this slider, not to the playhead or the page.
    event.stopPropagation();
    const next = resolve(raw);
    // At a limit nothing is committed, so nothing may be folded into later.
    if (next === null || next.valueUs === valueUs) return;
    const coalesce = event.repeat && keyRunRef.current;
    keyRunRef.current = true;
    onStart();
    onPreview(edge, next.valueUs);
    onCommit(next.valueUs, { coalesce, pointer: false, heldAtMinimum: next.heldAtMinimum });
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      className="trim-handle"
      data-edge={edge}
      data-dragging={live !== null}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={minUs / US_PER_SECOND}
      aria-valuemax={maxUs / US_PER_SECOND}
      aria-valuenow={shownUs / US_PER_SECOND}
      aria-valuetext={spoken(shownUs)}
      aria-describedby={describedBy}
      style={live && live.offsetPx !== 0 ? { transform: `translateX(${live.offsetPx}px)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => cancel(event.currentTarget)}
      onLostPointerCapture={(event) => cancel(event.currentTarget)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        keyRunRef.current = false;
      }}
      data-testid={edge === 'in' ? 'trim-start' : 'trim-end'}
    >
      <span className="trim-grip" aria-hidden="true" />
      {/* The piece's new length while dragging (and the change), so the
          result is visible before release. */}
      <span className="trim-label" aria-hidden="true" data-testid="trim-label">
        {`${formatLength(shownLengthUs, words)}${deltaText}`}
      </span>
    </div>
  );
}
