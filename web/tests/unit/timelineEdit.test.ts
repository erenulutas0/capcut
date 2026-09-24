import { describe, expect, it } from 'vitest';

import { addClip, createEmptyProject, setVideoAsset, updateClipRange } from '@/application/commands';
import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY, maxTimelineDurationUs } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { formatLength, MIN_CLIP_DURATION_US, US_PER_SECOND } from '@/domain/time';
import { totalOutputDurationUs } from '@/domain/timeline';
import {
  aspectForVideo,
  clampScroll,
  clampStripZoom,
  dragMinimumUs,
  freezeScale,
  maxStripZoom,
  MIN_DRAG_PIECE_US,
  MIN_VISIBLE_SPAN_US,
  pointerToUs,
  resolveEdgeTrim,
  resolvePendingEdge,
  scrollToShow,
  usToContentPx,
  zoomAround,
} from '@/domain/timelineEdit';
import { validateProject } from '@/domain/validation';

const S = US_PER_SECOND;
const MIN = 60 * S;
/** Doc 15 v5: 60 minutes of output, 120 minutes of input. */
const OUTPUT_LIMIT = WEB_LOCAL_POLICY.maxOutputDurationUs;
const INPUT_LIMIT = WEB_LOCAL_POLICY.maxTotalSourceDurationUs;
const RATE = { fpsNum: 30, fpsDen: 1 };

function withVideo(durationUs: number): Project {
  const video: AssetV1 = {
    assetId: 'a_video_001',
    kind: 'video',
    durationUs,
    displayWidth: 1080,
    displayHeight: 1920,
    hasAudio: true,
  };
  return setVideoAsset(createEmptyProject(), video);
}

function withRanges(ranges: Array<[number, number]>, durationUs = 110 * S): Project {
  let project = withVideo(durationUs);
  for (const [inUs, outUs] of ranges) {
    const result = addClip(project, { sourceInUs: inUs, sourceOutUs: outUs });
    if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
    project = result.project;
  }
  return project;
}

describe('ADR-021 limits, per kesit (ADR-026)', () => {
  it('a 90-minute kesit is a valid recipe; only its download is refused', () => {
    const project = withRanges([[0, 90 * MIN]], 90 * MIN);
    expect(totalOutputDurationUs(project)).toBe(90 * MIN);
    expect(validateProject(project).ok).toBe(true);
    expect(compileRenderPlan(project, WEB_LOCAL_POLICY)).toEqual({
      ok: false,
      reason: 'output_duration_exceeds_policy',
    });
  });

  it('the longest openable video (the input limit) fits as one kesit', () => {
    expect(maxTimelineDurationUs(WEB_LOCAL_POLICY)).toBe(INPUT_LIMIT);
    const project = withRanges([[0, INPUT_LIMIT]], INPUT_LIMIT);
    expect(validateProject(project).ok).toBe(true);
    // The kesitler together may not pass it.
    expect(addClip(project, { sourceInUs: 0, sourceOutUs: S })).toEqual({
      ok: false,
      reason: 'timeline_duration_exceeds_policy',
    });
  });

  it('40:00–1:40:00 of a 2-hour video downloads as exactly 60 minutes; 1 µs more is refused', () => {
    const kept = withRanges([[40 * MIN, 100 * MIN]], INPUT_LIMIT);
    const plan = compileRenderPlan(kept, WEB_LOCAL_POLICY);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.expectedDurationUs).toBe(OUTPUT_LIMIT);
    expect(plan.plan.totalFrames).toBe(108_000);
    const id = kept.clips[0]?.clipId ?? '';
    const over = updateClipRange(kept, id, { sourceInUs: 40 * MIN, sourceOutUs: 100 * MIN + 1 });
    if (!over.ok) throw new Error(over.reason);
    expect(compileRenderPlan(over.project, WEB_LOCAL_POLICY)).toEqual({
      ok: false,
      reason: 'output_duration_exceeds_policy',
    });
  });
});

describe('strip zoom', () => {
  it('fits the width at 1 and zooms in until 10 seconds fill it', () => {
    expect(maxStripZoom(2 * 60 * MIN)).toBe(720);
    expect(maxStripZoom(5 * S)).toBe(1);
    expect(maxStripZoom(0)).toBe(1);
    expect(clampStripZoom(0.2, 60 * S)).toBe(1);
    expect(clampStripZoom(100, 60 * S)).toBe(60 * S / MIN_VISIBLE_SPAN_US);
    expect(clampStripZoom(Number.NaN, 60 * S)).toBe(1);
  });

  it('zooming keeps the time under the anchor where it is', () => {
    const duration = 2 * 60 * MIN;
    const viewport = 1440;
    const before = { zoom: 4, scrollPx: 1000 };
    const anchor = 300;
    const timeBefore = ((before.scrollPx + anchor) / (viewport * before.zoom)) * duration;
    const after = zoomAround(before, 2, anchor, viewport, duration);
    expect(after.zoom).toBe(8);
    const timeAfter = ((after.scrollPx + anchor) / (viewport * after.zoom)) * duration;
    expect(Math.abs(timeAfter - timeBefore)).toBeLessThan(1);
    // Zooming out past 1 fits the whole video again, scroll 0.
    expect(zoomAround(after, 1 / 100, anchor, viewport, duration)).toEqual({ zoom: 1, scrollPx: 0 });
  });

  it('scroll stays inside the content', () => {
    expect(clampScroll(-5, 2, 1000)).toBe(0);
    expect(clampScroll(5000, 2, 1000)).toBe(1000);
    expect(clampScroll(Number.NaN, 2, 1000)).toBe(0);
  });

  it('the playhead stays in view: no scroll while inside, a page when it leaves', () => {
    const duration = 100 * S;
    const view = { zoom: 10, scrollPx: 0 };
    // 1000 px viewport at ×10: 1 s = 100 px.
    expect(usToContentPx(5 * S, duration, 10, 1000)).toBe(500);
    expect(scrollToShow(5 * S, duration, view, 1000)).toBe(0);
    expect(scrollToShow(20 * S, duration, view, 1000)).toBe(2000 - 1000 + 24);
    expect(scrollToShow(3 * S, duration, { zoom: 10, scrollPx: 2000 }, 1000)).toBe(300 - 24);
    // Not zoomed: never scrolls.
    expect(scrollToShow(90 * S, duration, { zoom: 1, scrollPx: 0 }, 1000)).toBe(0);
  });

  it('maps pointer x to video time with the scale frozen at pointer-down', () => {
    const scale = freezeScale(100, 1000, 110 * S);
    expect(scale.usPerPx).toBe(110_000);
    expect(pointerToUs(scale, 100, 110 * S - 1)).toBe(0);
    expect(pointerToUs(scale, 600, 110 * S - 1)).toBe(55 * S);
    expect(pointerToUs(scale, 50, 110 * S - 1)).toBe(0);
    expect(pointerToUs(scale, 5000, 110 * S - 1)).toBe(110 * S - 1);
    // A zero-width track (not laid out) still yields a finite scale.
    expect(Number.isFinite(freezeScale(0, 0, 10 * S).usPerPx)).toBe(true);
  });
});

describe('the edges of the range being marked', () => {
  const range = { sourceInUs: 10 * S, sourceOutUs: 20 * S };

  it('snaps to the frame grid inside the video', () => {
    expect(resolvePendingEdge(range, 'in', 12 * S + 10_000, 60 * S, RATE)).toEqual({
      valueUs: 12 * S,
      heldAtMinimum: false,
      lengthUs: 8 * S,
    });
    expect(resolvePendingEdge(range, 'out', 90 * S, 60 * S, RATE).valueUs).toBe(60 * S);
    expect(resolvePendingEdge(range, 'in', -5 * S, 60 * S, RATE).valueUs).toBe(0);
  });

  it('never leaves less than half a second, and says so', () => {
    const start = resolvePendingEdge(range, 'in', 19.9 * S, 60 * S, RATE);
    expect(start.heldAtMinimum).toBe(true);
    expect(start.lengthUs).toBeGreaterThanOrEqual(MIN_DRAG_PIECE_US);
    const end = resolvePendingEdge(range, 'out', Number.NEGATIVE_INFINITY, 60 * S, RATE);
    expect(end.heldAtMinimum).toBe(true);
    expect(end.lengthUs).toBeGreaterThanOrEqual(MIN_DRAG_PIECE_US);
  });

  it('the end of a video that is not on the grid is still reachable', () => {
    const odd = 20 * S + 12_345;
    expect(resolvePendingEdge(range, 'out', Number.POSITIVE_INFINITY, odd, RATE).valueUs).toBe(odd);
  });
});

describe('edge drag: never an accidental sub-second leftover', () => {
  const project = withRanges([[0, 14 * S]]);
  const clipId = project.clips[0]?.clipId ?? '';

  it('a normal drag trims to the frame grid and reports the new length', () => {
    const target = resolveEdgeTrim(project, clipId, 'out', 10 * S + 10_000, WEB_LOCAL_POLICY);
    expect(target).toEqual({ valueUs: 10 * S, heldAtMinimum: false, lengthUs: 10 * S });
  });

  it('holds the kesit at 0.5 s and says so, instead of leaving 0.2 s', () => {
    const out = resolveEdgeTrim(project, clipId, 'out', 200_000, WEB_LOCAL_POLICY);
    expect(out?.heldAtMinimum).toBe(true);
    expect(out?.lengthUs).toBeGreaterThanOrEqual(MIN_DRAG_PIECE_US);
    expect(out?.lengthUs).toBeLessThan(MIN_DRAG_PIECE_US + 40_000);
    const start = resolveEdgeTrim(project, clipId, 'in', 13.9 * S, WEB_LOCAL_POLICY);
    expect(start?.heldAtMinimum).toBe(true);
    expect((start?.lengthUs ?? 0) >= MIN_DRAG_PIECE_US).toBe(true);
    // End key on the start edge: as short as a drag may go.
    const end = resolveEdgeTrim(project, clipId, 'in', Number.POSITIVE_INFINITY, WEB_LOCAL_POLICY);
    expect(end?.heldAtMinimum).toBe(true);
  });

  it('a kesit already shorter than 0.5 s can only grow', () => {
    const tiny = withRanges([[10 * S, 10 * S + 200_000]]);
    const id = tiny.clips[0]?.clipId ?? '';
    expect(dragMinimumUs(200_000)).toBe(200_000);
    const shrink = resolveEdgeTrim(tiny, id, 'out', 10 * S + 100_000, WEB_LOCAL_POLICY);
    expect(shrink?.valueUs).toBe(10 * S + 200_000);
    expect(shrink?.heldAtMinimum).toBe(true);
    const grow = resolveEdgeTrim(tiny, id, 'out', 11 * S, WEB_LOCAL_POLICY);
    expect(grow).toEqual({ valueUs: 11 * S, heldAtMinimum: false, lengthUs: S });
  });

  it('the recipe itself still accepts 0.1 s kesitler (typed times)', () => {
    const result = updateClipRange(project, clipId, { sourceInUs: 0, sourceOutUs: MIN_CLIP_DURATION_US });
    expect(result.ok).toBe(true);
    expect(dragMinimumUs(10 * S)).toBe(MIN_DRAG_PIECE_US);
  });

  it('ADR-021: extending past the OUTPUT limit is allowed (the download gate asks to cut)', () => {
    // Two kesitler of a 55-minute video: 50 + 4 minutes. The second one may
    // grow to 20 minutes: 70 minutes joined, over the download limit.
    const long = withRanges([[0, 50 * MIN], [0, 4 * MIN]], 55 * MIN);
    const id = long.clips[1]?.clipId ?? '';
    const target = resolveEdgeTrim(long, id, 'out', 20 * MIN, WEB_LOCAL_POLICY);
    expect(target?.valueUs).toBe(20 * MIN);
    expect(target?.heldAtMinimum).toBe(false);
  });

  it('extending past the input limit (all kesitler together) stops at that limit', () => {
    // 100 + 4 minutes of a 110-minute video: the second kesit can only grow
    // to 20 minutes before the kesitler together reach 120.
    const long = withRanges([[0, 100 * MIN], [0, 4 * MIN]], 110 * MIN);
    const id = long.clips[1]?.clipId ?? '';
    const target = resolveEdgeTrim(long, id, 'out', 60 * MIN, WEB_LOCAL_POLICY);
    expect(target?.valueUs).toBe(20 * MIN);
    expect(target?.heldAtMinimum).toBe(false);
  });
});

describe('confirmation lengths', () => {
  const tr = { minute: 'dk', second: 'sn', decimalMark: ',' };
  it('reads to a tenth of a second', () => {
    expect(formatLength(14 * S, tr)).toBe('14,0 sn');
    expect(formatLength(10 * S, tr)).toBe('10,0 sn');
    expect(formatLength(250_000, tr)).toBe('0,3 sn');
    expect(formatLength(110 * S, tr)).toBe('1 dk 50,0 sn');
    expect(formatLength(59.96 * S, tr)).toBe('1 dk 0,0 sn');
    expect(formatLength(3.5 * S, { minute: 'min', second: 's', decimalMark: '.' })).toBe('3.5 s');
  });
});

describe('the frame follows the opened video', () => {
  it('portrait → 9:16, landscape → 16:9', () => {
    expect(aspectForVideo(1080, 1920)).toBe('9:16');
    expect(aspectForVideo(360, 640)).toBe('9:16');
    expect(aspectForVideo(480, 724)).toBe('9:16');
    expect(aspectForVideo(1920, 1080)).toBe('16:9');
    expect(aspectForVideo(640, 360)).toBe('16:9');
    // 4:3 and 3:4 are clearly not square.
    expect(aspectForVideo(1440, 1080)).toBe('16:9');
    expect(aspectForVideo(1080, 1440)).toBe('9:16');
  });

  it('near-square (within 5%) → 1:1', () => {
    expect(aspectForVideo(1080, 1080)).toBe('1:1');
    expect(aspectForVideo(1080, 1034)).toBe('1:1');
    expect(aspectForVideo(1034, 1080)).toBe('1:1');
    expect(aspectForVideo(1130, 1080)).toBe('1:1');
    // Just outside the tolerance.
    expect(aspectForVideo(1140, 1080)).toBe('16:9');
    expect(aspectForVideo(1020, 1080)).toBe('9:16');
  });

  it('an unknown size leaves the frame alone', () => {
    expect(aspectForVideo(undefined, 1080)).toBeNull();
    expect(aspectForVideo(1080, 0)).toBeNull();
    expect(aspectForVideo(Number.NaN, 1080)).toBeNull();
    expect(aspectForVideo(Number.POSITIVE_INFINITY, 1080)).toBeNull();
    expect(aspectForVideo(-1080, 1920)).toBeNull();
  });
});
