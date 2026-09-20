import { describe, expect, it } from 'vitest';

import { outputPixelSize } from '@/domain/edl';
import { computeSourceView, cropPixels, placeView, viewZoom } from '@/domain/transform';

describe('framing recipe', () => {
  it('cover on a 16:9 source targeting 9:16 crops the sides', () => {
    const view = computeSourceView(1920, 1080, '9:16', 'cover');
    // Region aspect must equal the canvas aspect.
    expect((view.width * 1920) / (view.height * 1080)).toBeCloseTo(9 / 16, 6);
    expect(view.height).toBe(1);
    expect(view.x).toBeCloseTo((1 - view.width) / 2, 6);
  });

  it('cover on a 9:16 source targeting 16:9 crops top and bottom', () => {
    const view = computeSourceView(1080, 1920, '16:9', 'cover');
    expect(view.width).toBe(1);
    expect((1080 * view.width) / (1920 * view.height)).toBeCloseTo(16 / 9, 6);
  });

  it('cover on a matching aspect keeps the full frame', () => {
    const view = computeSourceView(1920, 1080, '16:9', 'cover');
    expect(view).toMatchObject({ x: 0, y: 0, width: 1, height: 1, fit: 'cover' });
  });

  it('contain always keeps the whole frame', () => {
    const view = computeSourceView(1920, 1080, '9:16', 'contain');
    expect(view).toMatchObject({ x: 0, y: 0, width: 1, height: 1, fit: 'contain' });
  });

  it('zoom shrinks the region around its centre and round-trips', () => {
    const view = computeSourceView(1920, 1080, '16:9', 'cover', 2);
    expect(view.width).toBeCloseTo(0.5, 6);
    expect(view.x).toBeCloseTo(0.25, 6);
    expect(viewZoom(view, 1920, 1080, '16:9')).toBeCloseTo(2, 6);
  });

  it('never produces an out-of-bounds rect', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [640, 640],
      [3840, 1600],
    ] as const) {
      for (const aspect of ['9:16', '16:9', '1:1'] as const) {
        for (const zoom of [1, 1.5, 3]) {
          const view = computeSourceView(w, h, aspect, 'cover', zoom);
          expect(view.x).toBeGreaterThanOrEqual(0);
          expect(view.y).toBeGreaterThanOrEqual(0);
          expect(view.x + view.width).toBeLessThanOrEqual(1 + 1e-9);
          expect(view.y + view.height).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe('preview placement uses the same rect the encoder would', () => {
  it('cover fills the frame exactly', () => {
    const view = computeSourceView(1920, 1080, '9:16', 'cover');
    const placement = placeView(view, 1920, 1080, 360, 640);

    // `placement` positions the WHOLE source image; with cover it overflows the
    // frame. What must line up is the selected region.
    const scale = placement.width / 1920;
    const regionLeft = placement.left + view.x * 1920 * scale;
    const regionTop = placement.top + view.y * 1080 * scale;
    expect(regionLeft).toBeCloseTo(0, 4);
    expect(regionTop).toBeCloseTo(0, 4);
    expect(regionLeft + view.width * 1920 * scale).toBeCloseTo(360, 4);
    expect(regionTop + view.height * 1080 * scale).toBeCloseTo(640, 4);
    expect(placement.width).toBeGreaterThan(360);
  });

  it('contain letterboxes and stays inside the frame', () => {
    const view = computeSourceView(1920, 1080, '9:16', 'contain');
    const placement = placeView(view, 1920, 1080, 360, 640);
    expect(placement.width).toBeCloseTo(360, 4);
    expect(placement.height).toBeCloseTo(202.5, 4);
    expect(placement.top).toBeCloseTo((640 - 202.5) / 2, 4);
  });

  it('crop pixels stay inside the source and stay even', () => {
    const view = computeSourceView(1920, 1080, '9:16', 'cover');
    const crop = cropPixels(view, 1920, 1080);
    expect(crop.width % 2).toBe(0);
    expect(crop.height % 2).toBe(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1920);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBe(608); // 1080 * 9/16 = 607.5 -> 608
  });
});

describe('output pixel sizes follow doc 09', () => {
  it('maps short edge 1080 to the documented frames', () => {
    expect(outputPixelSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputPixelSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputPixelSize('1:1', 1080)).toEqual({ width: 1080, height: 1080 });
    expect(outputPixelSize('9:16', 720)).toEqual({ width: 720, height: 1280 });
  });
});
