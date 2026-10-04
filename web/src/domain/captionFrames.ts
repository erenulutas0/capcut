/**
 * "Does this line fit whatever frame the user picks?" (ADR-036).
 *
 * Kept apart from captionLayout.ts on purpose: that module has no runtime
 * import (the export matrix compiles it on its own to measure caption
 * boxes); this one needs the frame sizes from edl.ts.
 */

import { layoutCaption, type CaptionFrame, type MeasureText } from './captionLayout';
import { outputPixelSize, type CaptionStyleV2 } from './edl';

/** Every frame a download can have: the three shapes at 720p and Full HD. */
export const ALL_CAPTION_FRAMES: readonly CaptionFrame[] = (['9:16', '16:9', '1:1'] as const).flatMap((aspect) =>
  [720, 1080].map((shortEdge) => ({ aspect, ...outputPixelSize(aspect, shortEdge) })),
);

/**
 * Whether a line fits (two lines at most) in every one of them. The
 * transcript's lines are made to pass this, so a subtitle the app wrote
 * itself is never the reason an export is refused.
 */
export function fitsEveryFrame(text: string, style: CaptionStyleV2, measure: MeasureText): boolean {
  return ALL_CAPTION_FRAMES.every((frame) => layoutCaption(text, style, frame, measure).ok);
}
