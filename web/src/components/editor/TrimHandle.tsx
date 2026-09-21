'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { formatSpokenTime, formatTimecode, US_PER_SECOND, type Micros } from '@/domain/time';
import type { TrimEdge } from '@/domain/trim';
import type { MessageKey } from '@/i18n/messages';

interface Props {
  t: (key: MessageKey) => string;
  edge: TrimEdge;
  /** Accessible name, e.g. "An 2 başlangıcı". */
  label: string;
  valueUs: Micros;
  minUs: Micros;
  maxUs: Micros;
  /** One output frame; the arrow-key step. */
  frameUs: Micros;
  /** Output duration the strip track represents, used for the drag scale. */
  totalUs: Micros;
  /** Where the preview is before a drag, so Escape can put it back. */
  playheadSourceUs: Micros;
  describedBy: string;
  /** Raw wish -> legal, snapped value (domain `resolveTrimTarget`). */
  resolve: (rawUs: number) => Micros | null;
  onStart: () => void;
  onPreview: (edge: TrimEdge, us: Micros) => void;
  onCancel: (restoreSourceUs: Micros) => void;
  onCommit: (us: Micros, coalesce: boolean) => void;
}

interface DragSession {
  pointerId: number;
  startX: number;
  usPerPx: number;
  startUs: Micros;
  valueUs: Micros;
  restoreSourceUs: Micros;
}

const SECOND_STEP_US = US_PER_SECOND;

/**
 * One edge of the selected moment on the output strip.
 *
 * Pointer Events with pointer capture cover mouse, touch and pen with one code
 * path. Moving only previews: the recipe changes once, on release, so a drag
 * is one undo step and autosave does not write thirty intermediate states.
 * It is also a real slider for keyboard and screen-reader users.
 */
export function TrimHandle({
  t,
  edge,
  label,
  valueUs,
  minUs,
  maxUs,
  frameUs,
  totalUs,
  playheadSourceUs,
  describedBy,
  resolve,
  onStart,
  onPreview,
  onCancel,
  onCommit,
}: Props) {
  // The session lives in a ref because pointer events can arrive faster than
  // React re-renders; `live` only mirrors it for drawing.
  const sessionRef = useRef<DragSession | null>(null);
  // True after a key press on this handle, until focus leaves: auto-repeated
  // presses of the same run fold into that press's undo step.
  const keyRunRef = useRef(false);
  const [live, setLive] = useState<{ valueUs: Micros; offsetPx: number } | null>(null);

  const shownUs = live?.valueUs ?? valueUs;
  const spoken = (us: Micros) =>
    formatSpokenTime(us, {
      minute: t('time.minute'),
      second: t('time.second'),
      decimalMark: t('time.decimalMark'),
    });

  const finish = () => {
    sessionRef.current = null;
    setLive(null);
  };

  const cancel = (element: HTMLElement) => {
    const session = sessionRef.current;
    if (!session) return;
    if (element.hasPointerCapture(session.pointerId)) {
      element.releasePointerCapture(session.pointerId);
    }
    finish();
    onCancel(session.restoreSourceUs);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (sessionRef.current) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.focus();
    element.setPointerCapture(event.pointerId);

    const track = element.closest('.strip-track');
    const width = track?.getBoundingClientRect().width ?? 0;
    // The scale is frozen for the whole drag so the layout reacting to the
    // result can never feed back into the value.
    const usPerPx = width > 0 && totalUs > 0 ? totalUs / width : frameUs;

    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      usPerPx,
      startUs: valueUs,
      valueUs,
      restoreSourceUs: playheadSourceUs,
    };
    keyRunRef.current = false;
    setLive({ valueUs, offsetPx: 0 });
    onStart();
    onPreview(edge, valueUs);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const raw = session.startUs + (event.clientX - session.startX) * session.usPerPx;
    const next = resolve(raw);
    if (next === null || next === session.valueUs) return;
    session.valueUs = next;
    setLive({ valueUs: next, offsetPx: (next - session.startUs) / session.usPerPx });
    onPreview(edge, next);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    finish();
    if (session.valueUs !== session.startUs) onCommit(session.valueUs, false);
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
    const next = resolve(raw);
    // At a limit nothing is committed, so nothing may be folded into later.
    if (next === null || next === valueUs) return;
    const coalesce = event.repeat && keyRunRef.current;
    keyRunRef.current = true;
    onStart();
    onPreview(edge, next);
    onCommit(next, coalesce);
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
      <span className="trim-label" aria-hidden="true" data-testid="trim-label">
        {formatTimecode(shownUs)}
      </span>
    </div>
  );
}
