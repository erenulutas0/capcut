/**
 * Draws captions onto a 2D canvas. The ONE implementation used by both the
 * preview (window) and the export worker, so what the user sees is what the
 * file gets (ADR-015).
 *
 * The typeface is bundled (Inter Bold, SIL OFL 1.1, `public/fonts/caption/`)
 * instead of taken from the system: a system font differs between machines
 * and would make the preview promise a look the export cannot keep. Glyphs
 * Inter lacks (emoji) fall back to the browser's own font in both places.
 */

import {
  layoutCaption,
  type CaptionFrame,
  type CaptionLayout,
  type CaptionLayoutResult,
  type MeasureText,
} from '../domain/captionLayout';
import type { CaptionPreset, CaptionStyleV2 } from '../domain/edl';
import { BASE_PATH } from '../basePath';

export const CAPTION_FONT_FAMILY = 'Clip Caption';

/** The two Inter subsets that cover Turkish and English (from @fontsource/inter 5.3.0). */
const FACES = [
  {
    file: 'inter-latin-700-normal.woff2',
    unicodeRange:
      'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
      'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  },
  {
    file: 'inter-latin-ext-700-normal.woff2',
    unicodeRange:
      'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,' +
      'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  },
] as const;

/** Includes the deploy sub-path (GitHub Pages serves the app under /capcut). */
export const CAPTION_FONT_PATH = `${BASE_PATH}/fonts/caption/`;

const loaded = new WeakMap<FontFaceSet, Promise<boolean>>();

/**
 * Loads the caption typeface into a font set (`document.fonts` or a worker's
 * `self.fonts`). Resolves false instead of throwing: the caller decides what
 * a missing font means (the preview says so; the export refuses).
 */
export function loadCaptionFont(fonts: FontFaceSet, origin: string): Promise<boolean> {
  const existing = loaded.get(fonts);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const faces = FACES.map(
        (face) =>
          new FontFace(CAPTION_FONT_FAMILY, `url(${origin}${CAPTION_FONT_PATH}${face.file})`, {
            weight: '700',
            style: 'normal',
            unicodeRange: face.unicodeRange,
          }),
      );
      await Promise.all(faces.map((face) => face.load()));
      for (const face of faces) fonts.add(face);
      return true;
    } catch {
      loaded.delete(fonts);
      return false;
    }
  })();
  loaded.set(fonts, promise);
  return promise;
}

export function captionFont(fontPx: number): string {
  return `700 ${fontPx}px "${CAPTION_FONT_FAMILY}"`;
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function canvasMeasure(context: Context2D): MeasureText {
  return (text, fontPx) => {
    context.font = captionFont(fontPx);
    return context.measureText(text).width;
  };
}

function roundedRect(
  context: Context2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height - r);
  context.arcTo(x + width, y + height, x + width - r, y + height, r);
  context.lineTo(x + r, y + height);
  context.arcTo(x, y + height, x, y + height - r, r);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
  context.closePath();
}

/** Colours are fixed per preset: the recipe stores a preset, not free styling. */
export const CAPTION_COLORS = {
  text: '#ffffff',
  box: 'rgba(0, 0, 0, 0.72)',
  outline: '#000000',
} as const;

export function drawCaptionLayout(context: Context2D, layout: CaptionLayout, preset: CaptionPreset): void {
  context.save();
  context.font = captionFont(layout.fontPx);
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  if (preset === 'box') {
    const { x, y, width, height } = layout.box;
    context.fillStyle = CAPTION_COLORS.box;
    roundedRect(context, x, y, width, height, layout.radiusPx);
    context.fill();
  }

  for (const line of layout.lines) {
    if (preset === 'outline') {
      context.lineJoin = 'round';
      context.miterLimit = 2;
      // The stroke is centred on the glyph edge, so twice the width shows
      // `outlinePx` outside the letter.
      context.lineWidth = layout.outlinePx * 2;
      context.strokeStyle = CAPTION_COLORS.outline;
      context.strokeText(line.text, line.centerX, line.centerY);
    }
    context.fillStyle = CAPTION_COLORS.text;
    context.fillText(line.text, line.centerX, line.centerY);
  }
  context.restore();
}

/** Layout + draw in one call. Returns the layout result so callers can report "does not fit". */
export function drawCaption(
  context: Context2D,
  text: string,
  style: CaptionStyleV2,
  frame: CaptionFrame,
): CaptionLayoutResult {
  const result = layoutCaption(text, style, frame, canvasMeasure(context));
  if (result.ok) drawCaptionLayout(context, result.layout, style.preset);
  return result;
}
