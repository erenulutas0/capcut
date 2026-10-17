'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { gifRangeLength, moveGifEdge, moveGifRange, type GifRange } from '@/domain/gif';
import { formatClock, US_PER_SECOND } from '@/domain/time';

/** One press of an arrow key; with Shift, four. */
const KEY_STEP_US = US_PER_SECOND / 2;

type Part = 'window' | 'start' | 'end';

interface Props {
  videoUs: number;
  range: GifRange;
  disabled: boolean;
  /** `capped`: the user asked for more than ten seconds; the part stopped at ten. */
  onChange: (range: GifRange, capped: boolean) => void;
  labels: { window: string; start: string; end: string; valueText: (from: string, to: string) => string };
}

function partOf(element: Element): Part {
  const part = element.getAttribute('data-part');
  return part === 'start' || part === 'end' ? part : 'window';
}

/** Seconds with one decimal, for the sliders' values. */
function tenths(us: number): number {
  return Math.round(us / 100_000) / 10;
}

/**
 * The part of the video the GIF is made of (ADR-046, mockup B): a bar the
 * length of the video with the chosen part on it. Drag the part to move it,
 * drag either edge to make it longer or shorter — at most ten seconds, which
 * the screen then says in words. Each of the three is a slider for the
 * keyboard and a screen reader too (arrows half a second, Shift two seconds,
 * Home / End), and each is at least 44 px to a finger.
 */
export function GifRangeBar({ videoUs, range, disabled, onChange, labels }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ part: Part; pointerId: number; startX: number; from: GifRange } | null>(null);
  const share = (us: number) => (videoUs > 0 ? (us / videoUs) * 100 : 0);
  const length = gifRangeLength(range);

  const moveTo = (part: Part, from: GifRange, value: number) => {
    if (part === 'window') {
      onChange(moveGifRange(from, value, videoUs), false);
      return;
    }
    const moved = moveGifEdge(from, part, value, videoUs);
    onChange(moved.range, moved.capped);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const part = partOf(event.currentTarget);
    let from = range;
    const track = trackRef.current;
    if (part === 'window' && track) {
      // A press on the bar outside the part brings the part there (centred on the press), then it drags.
      const box = track.getBoundingClientRect();
      const atUs = box.width > 0 ? ((event.clientX - box.left) / box.width) * videoUs : range.startUs;
      if (atUs < range.startUs || atUs > range.endUs) {
        from = moveGifRange(range, atUs - length / 2, videoUs);
        onChange(from, false);
      }
    }
    drag.current = { part, pointerId: event.pointerId, startX: event.clientX, from };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const track = trackRef.current;
    if (!current || current.pointerId !== event.pointerId || !track) return;
    const width = track.getBoundingClientRect().width;
    if (width <= 0) return;
    const deltaUs = ((event.clientX - current.startX) / width) * videoUs;
    const { from, part } = current;
    moveTo(part, from, (part === 'end' ? from.endUs : from.startUs) + deltaUs);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const part = partOf(event.currentTarget);
    const now = part === 'end' ? range.endUs : range.startUs;
    const step = event.shiftKey ? KEY_STEP_US * 4 : KEY_STEP_US;
    let to: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') to = now - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') to = now + step;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = videoUs;
    if (to === null) return;
    event.preventDefault();
    moveTo(part, range, to);
  };

  const valueText = labels.valueText(formatClock(range.startUs, 'floor'), formatClock(range.endUs, 'floor'));
  const common = {
    role: 'slider',
    tabIndex: disabled ? -1 : 0,
    'aria-valuetext': valueText,
    'aria-disabled': disabled || undefined,
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  } as const;

  // The whole bar is the slider that moves the part (a target as wide as the bar, ADR-046); the part
  // drawn on it is only its picture. The two edges are sliders of their own, beside it in the page
  // (a slider holds no other control) and drawn on top of it.
  return (
    <div className="gif-range-wrap" data-disabled={disabled} data-testid="gif-range">
      <div
        {...common}
        className="gif-range"
        ref={trackRef}
        aria-label={labels.window}
        aria-valuemin={0}
        aria-valuemax={tenths(Math.max(0, videoUs - length))}
        aria-valuenow={tenths(range.startUs)}
        data-part="window"
        data-start-us={range.startUs}
        data-end-us={range.endUs}
        data-testid="gif-range-window"
      >
        <div className="gif-range-window" style={{ left: `${share(range.startUs)}%`, width: `${share(length)}%` }} />
      </div>
      <div
        {...common}
        className="gif-range-edge"
        style={{ left: `${share(range.startUs)}%` }}
        aria-label={labels.start}
        aria-valuemin={0}
        aria-valuemax={tenths(range.endUs)}
        aria-valuenow={tenths(range.startUs)}
        data-part="start"
        data-testid="gif-range-start"
      />
      <div
        {...common}
        className="gif-range-edge"
        style={{ left: `${share(range.endUs)}%` }}
        aria-label={labels.end}
        aria-valuemin={tenths(range.startUs)}
        aria-valuemax={tenths(videoUs)}
        aria-valuenow={tenths(range.endUs)}
        data-part="end"
        data-testid="gif-range-end"
      />
    </div>
  );
}
