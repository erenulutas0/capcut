'use client';

import { useEffect, useRef } from 'react';

import { drawCaption } from '@/adapters/captionRender';
import type { AspectRatio, CaptionStyleV2 } from '@/domain/edl';

interface Props {
  /** The line to show now, or null for none (no cue, source mode, font not ready). */
  text: string | null;
  cueId: string | null;
  style: CaptionStyleV2;
  aspect: AspectRatio;
  /** The rendered output frame box in CSS pixels; the canvas covers it exactly. */
  width: number;
  height: number;
}

/**
 * Draws the active caption over the result preview with the SAME module the
 * export worker uses (adapters/captionRender.ts).
 *
 * The backing store is the displayed box times devicePixelRatio, and the
 * layout takes that as its frame: every size in the layout is a share of the
 * frame, so the caption keeps the export's proportions at any preview size
 * while staying sharp on high-density screens.
 *
 * It only redraws when what it shows changes (line, style, box). The playhead
 * itself does not trigger a draw; during playback the parent re-renders on
 * every animation frame and this effect is skipped unless the line changed.
 */
export function CaptionOverlay({ text, cueId, style, aspect, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { preset, position, size } = style;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    // Assigning a size clears the canvas even when unchanged, so only on change.
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    if (text === null) return;
    // A line that does not fit is not drawn here either; the caption panel
    // says so on that line ("Sığmıyor, kısalt").
    drawCaption(context, text, { preset, position, size }, {
      width: pixelWidth,
      height: pixelHeight,
      aspect,
    });
  }, [text, preset, position, size, aspect, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="caption-overlay"
      style={{ width, height }}
      // The words are in the caption panel as real text; this is pixels only.
      aria-hidden="true"
      data-testid="caption-overlay"
      data-cue-id={cueId ?? ''}
    />
  );
}
