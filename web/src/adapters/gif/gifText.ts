/**
 * Draws the top and bottom text of a GIF (ADR-046) onto a 2D canvas: the
 * caption typeface (Inter Bold, bundled, covers every Turkish letter —
 * ADR-015), white letters with a dark edge, the layout of `domain/gif.ts`.
 * The worker draws every frame through here; the page measures through the
 * same `gifMeasure`, so its preview wraps the lines where the GIF does.
 */

import { captionFont } from '@/adapters/captionRender';
import { layoutGifText, type GifSize, type GifTextLayout, type GifTexts, type MeasureGifText } from '@/domain/gif';

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const GIF_TEXT_FILL = '#ffffff';
export const GIF_TEXT_EDGE = '#000000';

export function gifMeasure(context: Context2D): MeasureGifText {
  return (text, fontPx) => {
    context.font = captionFont(fontPx);
    return context.measureText(text).width;
  };
}

export function gifTextLayouts(texts: GifTexts, size: GifSize, measure: MeasureGifText): GifTextLayout[] {
  const layouts: GifTextLayout[] = [];
  const top = layoutGifText(texts.top, 'top', size, measure);
  const bottom = layoutGifText(texts.bottom, 'bottom', size, measure);
  if (top) layouts.push(top);
  if (bottom) layouts.push(bottom);
  return layouts;
}

export function drawGifText(context: Context2D, layouts: readonly GifTextLayout[]): void {
  for (const layout of layouts) {
    context.save();
    context.font = captionFont(layout.fontPx);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.miterLimit = 2;
    for (const line of layout.lines) {
      // The stroke is centred on the letter's edge: twice the width shows `outlinePx` outside it.
      context.lineWidth = layout.outlinePx * 2;
      context.strokeStyle = GIF_TEXT_EDGE;
      context.strokeText(line.text, line.centerX, line.centerY);
      context.fillStyle = GIF_TEXT_FILL;
      context.fillText(line.text, line.centerX, line.centerY);
    }
    context.restore();
  }
}
