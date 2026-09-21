/**
 * Where a caption goes on an output frame, and how it wraps.
 *
 * Pure: the only thing it needs from a real font is a width, supplied by the
 * caller as `measure`. The preview canvas and the export worker both call this
 * with the same bundled font, so the line breaks and the box are identical in
 * what the user sees and in the file they get (ADR-015).
 *
 * Every number is rounded to whole pixels here, once, so drawing never has to
 * make its own layout decisions.
 */

import type { AspectRatio, CaptionPosition, CaptionSize, CaptionStyleV2 } from './edl';
import { CAPTION_LIMITS } from './captions';

export type MeasureText = (text: string, fontPx: number) => number;

export interface CaptionFrame {
  width: number;
  height: number;
  aspect: AspectRatio;
}

export interface CaptionLine {
  text: string;
  /** Horizontal centre of the line. */
  centerX: number;
  /** Vertical centre of the line box; draw with textBaseline = 'middle'. */
  centerY: number;
  width: number;
}

export interface CaptionLayout {
  fontPx: number;
  lineHeightPx: number;
  lines: CaptionLine[];
  /** Background rectangle for the `box` preset; also the caption's footprint. */
  box: { x: number; y: number; width: number; height: number };
  radiusPx: number;
  /** Stroke width for the `outline` preset. */
  outlinePx: number;
}

export type CaptionLayoutResult =
  | { ok: true; layout: CaptionLayout }
  | { ok: false; reason: 'caption_does_not_fit' };

/** Font size as a share of the frame's short edge. */
const SIZE_FACTOR: Record<CaptionSize, number> = {
  small: 0.042,
  medium: 0.052,
  large: 0.066,
};

/**
 * Safe margins as a share of the frame. Vertical video is watched inside apps
 * that lay their own buttons and captions over the bottom and top, so 9:16
 * keeps text further in.
 */
function margins(aspect: AspectRatio): { x: number; top: number; bottom: number } {
  if (aspect === '9:16') return { x: 0.08, top: 0.1, bottom: 0.16 };
  return { x: 0.08, top: 0.08, bottom: 0.08 };
}

/** Greedy word wrap; a single word wider than the line is split by character. */
export function wrapCaptionText(
  text: string,
  maxWidth: number,
  fontPx: number,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(String.fromCharCode(0x0a))) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (measure(candidate, fontPx) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== '') lines.push(current);
      if (measure(word, fontPx) <= maxWidth) {
        current = word;
        continue;
      }
      // Break an over-long word by code point so emoji and Turkish letters
      // are never cut in half.
      let piece = '';
      for (const char of Array.from(word)) {
        if (piece !== '' && measure(piece + char, fontPx) > maxWidth) {
          lines.push(piece);
          piece = char;
        } else {
          piece += char;
        }
      }
      current = piece;
    }
    if (current !== '') lines.push(current);
  }
  return lines;
}

function verticalStart(
  position: CaptionPosition,
  frameHeight: number,
  boxHeight: number,
  margin: { top: number; bottom: number },
): number {
  switch (position) {
    case 'top':
      return Math.round(frameHeight * margin.top);
    case 'middle':
      return Math.round((frameHeight - boxHeight) / 2);
    case 'bottom':
      return Math.round(frameHeight * (1 - margin.bottom) - boxHeight);
  }
}

export function layoutCaption(
  text: string,
  style: CaptionStyleV2,
  frame: CaptionFrame,
  measure: MeasureText,
): CaptionLayoutResult {
  const shortEdge = Math.min(frame.width, frame.height);
  const fontPx = Math.max(10, Math.round(shortEdge * SIZE_FACTOR[style.size]));
  const lineHeightPx = Math.round(fontPx * 1.25);
  const padX = Math.round(fontPx * 0.45);
  const padY = Math.round(fontPx * 0.25);
  const margin = margins(frame.aspect);
  const maxTextWidth = frame.width - 2 * Math.round(frame.width * margin.x) - 2 * padX;

  const wrapped = wrapCaptionText(text, maxTextWidth, fontPx, measure);
  // Never shrink text to make it fit: a caption that needs a third line is
  // reported, so the user shortens it instead of getting unreadable type.
  if (wrapped.length === 0 || wrapped.length > CAPTION_LIMITS.maxLines) {
    return { ok: false, reason: 'caption_does_not_fit' };
  }

  const widths = wrapped.map((line) => Math.ceil(measure(line, fontPx)));
  const boxWidth = Math.max(...widths) + 2 * padX;
  const boxHeight = wrapped.length * lineHeightPx + 2 * padY;
  const boxX = Math.round((frame.width - boxWidth) / 2);
  const boxY = verticalStart(style.position, frame.height, boxHeight, margin);
  const centerX = Math.round(frame.width / 2);

  return {
    ok: true,
    layout: {
      fontPx,
      lineHeightPx,
      lines: wrapped.map((line, index) => ({
        text: line,
        centerX,
        centerY: boxY + padY + index * lineHeightPx + Math.round(lineHeightPx / 2),
        width: widths[index] ?? 0,
      })),
      box: { x: boxX, y: boxY, width: boxWidth, height: boxHeight },
      radiusPx: Math.round(fontPx * 0.2),
      outlinePx: Math.max(2, Math.round(fontPx * 0.12)),
    },
  };
}
