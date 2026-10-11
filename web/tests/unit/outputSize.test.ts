import { describe, expect, it } from 'vitest';

import { addClip, createEmptyProject, setExportShortEdge, setFraming, setVideoAsset } from '@/application/commands';
import type { AspectRatio, AssetV1, FitMode, Project } from '@/domain/edl';
import { fastCutEligibility, type FastCutSourceFacts } from '@/domain/fastPath';
import { DEFAULT_KESIT_SETTINGS, wholeVideoRecipe } from '@/domain/kesit';
import { MIN_CAPTION_SHORT_EDGE, MIN_OUTPUT_SHORT_EDGE, nativeShortEdge, outputSizeFor, segmentScale } from '@/domain/outputSize';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan, type RenderPlan } from '@/domain/renderPlan';
import { aspectForVideo } from '@/domain/timelineEdit';
import { US_PER_SECOND } from '@/domain/time';

/**
 * ADR-041 — the picture is never enlarged. `export.shortEdge` is a ceiling;
 * the frame is the picture's own pixels under it, on every road that ends in
 * a file (they all compile a render plan).
 */

const S = US_PER_SECOND;

function video(displayWidth: number, displayHeight: number, assetId = 'a_video_001'): AssetV1 {
  return { assetId, kind: 'video', durationUs: 20 * S, displayWidth, displayHeight, hasAudio: true };
}

/** The editor opened directly: the video, the frame of its orientation, the default limit, no kesit. */
function openedInEditor(displayWidth: number, displayHeight: number): Project {
  const project = setVideoAsset(createEmptyProject(), video(displayWidth, displayHeight));
  const aspect = aspectForVideo(displayWidth, displayHeight);
  return aspect ? setFraming(project, { aspect }) : project;
}

function planOf(project: Project, settings = DEFAULT_KESIT_SETTINGS): RenderPlan {
  const recipe = project.clips.length > 0 ? project : wholeVideoRecipe(project, settings);
  if (!recipe) throw new Error('no recipe');
  const compiled = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
  if (!compiled.ok) throw new Error(compiled.reason);
  return compiled.plan;
}

const size = (plan: RenderPlan): [number, number] => [plan.width, plan.height];

describe('the editor’s default follows the source (item 2 of 11 Oct 2026)', () => {
  it('a video opened in the editor downloads at its own size — 1080p was the answer for everything before', () => {
    expect(size(planOf(openedInEditor(1280, 720)))).toEqual([1280, 720]);
    expect(size(planOf(openedInEditor(1920, 1080)))).toEqual([1920, 1080]);
    expect(size(planOf(openedInEditor(854, 480)))).toEqual([854, 480]);
    expect(size(planOf(openedInEditor(640, 360)))).toEqual([640, 360]);
    expect(size(planOf(openedInEditor(720, 1280)))).toEqual([720, 1280]);
    expect(size(planOf(openedInEditor(360, 640)))).toEqual([360, 640]);
    expect(size(planOf(openedInEditor(720, 720)))).toEqual([720, 720]);
  });

  it('never larger than the ceiling: 4K is Full HD, and “en çok 720p” holds a 1080p video to 720p', () => {
    expect(size(planOf(openedInEditor(3840, 2160)))).toEqual([1920, 1080]);
    expect(planOf(openedInEditor(3840, 2160)).sizeRule).toBe('ceiling');
    expect(size(planOf(setExportShortEdge(openedInEditor(1920, 1080), 720)))).toEqual([1280, 720]);
    // The limit is a limit: on a smaller video it changes nothing.
    expect(size(planOf(setExportShortEdge(openedInEditor(640, 360), 720)))).toEqual([640, 360]);
  });

  it('a stored recipe keeps its number; what it means is “at most”', () => {
    // A project saved before ADR-041 says 1080 (the old default) or 720 (chosen): neither field changes.
    const stored = openedInEditor(1280, 720);
    expect(stored.export.shortEdge).toBe(1080);
    expect(stored.schemaVersion).toBe(createEmptyProject().schemaVersion);
    expect(size(planOf(stored))).toEqual([1280, 720]);
  });

  it('the fast cut applies in the editor wherever it applies in a wizard: same recipe size, same answer', () => {
    const facts = (displayWidth: number, displayHeight: number): FastCutSourceFacts => ({
      codec: 'avc',
      isobmff: true,
      hdr: false,
      sps: { chromaFormatIdc: 1, bitDepthLuma: 8, bitDepthChroma: 8, frameMbsOnly: true },
      lengthSize: 4,
      displayWidth,
      displayHeight,
      squarePixels: true,
      fullRange: false,
      wideGamut: false,
      needsReorderFix: false,
    });
    for (const [width, height] of [[1280, 720], [1920, 1080], [854, 480], [640, 360], [720, 1280]] as const) {
      const cut = addClip(openedInEditor(width, height), { sourceInUs: 2 * S, sourceOutUs: 5 * S }, WEB_LOCAL_POLICY, DEFAULT_KESIT_SETTINGS);
      if (!cut.ok) throw new Error(cut.reason);
      expect(fastCutEligibility(planOf(cut.project), facts(width, height), 'auto'), `${width}×${height}`).toEqual({ ok: true });
    }
    // Larger than the ceiling: encoded to it, as before.
    const big = addClip(openedInEditor(3840, 2160), { sourceInUs: 2 * S, sourceOutUs: 5 * S }, WEB_LOCAL_POLICY, DEFAULT_KESIT_SETTINGS);
    if (!big.ok) throw new Error(big.reason);
    expect(fastCutEligibility(planOf(big.project), facts(3840, 2160), 'auto')).toEqual({ ok: false, reason: 'resolution' });
  });
});

describe('never enlarged (item 3)', () => {
  const SOURCES: ReadonlyArray<readonly [number, number]> = [
    [3840, 2160], [2560, 1440], [1920, 1080], [1920, 1088], [1280, 720], [960, 540], [854, 480], [848, 480], [640, 480], [640, 360], [480, 360],
    [426, 240], [320, 240], [1080, 1920], [720, 1280], [592, 1280], [480, 854], [360, 640], [1080, 1080], [720, 720], [480, 480], [1440, 1080],
  ];
  const ASPECTS: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];
  const FITS: readonly FitMode[] = ['cover', 'contain'];

  it('for every source, frame shape, fit, zoom and limit: no source pixel covers more than one output pixel', () => {
    let checked = 0;
    for (const [width, height] of SOURCES) {
      for (const aspect of ASPECTS) {
        for (const fit of FITS) {
          for (const zoom of [1, 1.5, 2, 3]) {
            for (const ceiling of [1080, 720]) {
              const base = setExportShortEdge(setFraming(setVideoAsset(createEmptyProject(), video(width, height)), { aspect }), ceiling);
              const plan = planOf(base, { ...DEFAULT_KESIT_SETTINGS, fit, zoom });
              const name = `${width}×${height} ${aspect} ${fit} ×${zoom} ≤${ceiling} → ${plan.width}×${plan.height}`;
              const segment = plan.segments[0]!;
              const scale = segmentScale(plan, segment) ?? 0;
              const shortEdge = Math.min(plan.width, plan.height);
              // Even dimensions, never above the limit.
              expect(plan.width % 2, name).toBe(0);
              expect(plan.height % 2, name).toBe(0);
              expect(shortEdge, name).toBeLessThanOrEqual(ceiling);
              if (plan.sizeRule === 'floor') {
                // The one exception: a slice under 144 px is brought up to the smallest frame.
                expect(shortEdge, name).toBe(MIN_OUTPUT_SHORT_EDGE);
                expect(Math.min(segment.crop.width, segment.crop.height), name).toBeLessThan(MIN_OUTPUT_SHORT_EDGE);
              } else {
                expect(scale, name).toBeLessThanOrEqual(1 + 1e-9);
                // "Doldur": the frame is covered by the slice, so it holds no more pixels than the slice — or the source.
                if (fit === 'cover') {
                  expect(plan.width * plan.height, name).toBeLessThanOrEqual(segment.crop.width * segment.crop.height);
                  expect(plan.width * plan.height, name).toBeLessThanOrEqual(width * height);
                }
              }
              // …and not smaller than it has to be: under the limit the picture is kept 1:1 (give or take the even rounding).
              if (plan.sizeRule === 'source') expect(scale, name).toBeGreaterThan(0.98);
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBe(SOURCES.length * 3 * 2 * 4 * 2);
  });

  it('a video in the frame of its own shape keeps exactly its pixel count, at 360p, 480p and 720p alike', () => {
    for (const [width, height] of [[640, 360], [854, 480], [1280, 720], [360, 640], [480, 854], [720, 1280]] as const) {
      const plan = planOf(openedInEditor(width, height));
      expect(plan.width * plan.height, `${width}×${height}`).toBe(width * height);
    }
  });

  it('“Dikey yap” from a small landscape video: the slice at its own pixels, not a blown-up 1080 × 1920', () => {
    const vertical = (width: number, height: number, fit: FitMode) =>
      size(planOf(setFraming(setVideoAsset(createEmptyProject(), video(width, height)), { aspect: '9:16' }), { ...DEFAULT_KESIT_SETTINGS, fit }));
    expect(vertical(640, 360, 'cover')).toEqual([202, 360]);
    expect(vertical(854, 480, 'cover')).toEqual([270, 480]);
    expect(vertical(1280, 720, 'cover')).toEqual([406, 720]);
    // "Sığdır": bars are added, the picture is not — the frame is exactly as wide as the picture.
    expect(vertical(640, 360, 'contain')).toEqual([640, 1138]);
    expect(vertical(854, 480, 'contain')).toEqual([854, 1518]);
  });

  it('zooming in keeps the pixels that are left: no enlargement to fill the old frame', () => {
    expect(size(planOf(openedInEditor(1920, 1080), { ...DEFAULT_KESIT_SETTINGS, zoom: 2 }))).toEqual([960, 540]);
    expect(size(planOf(openedInEditor(1280, 720), { ...DEFAULT_KESIT_SETTINGS, zoom: 2 }))).toEqual([640, 360]);
  });

  it('kesitler from videos of different sizes: one file has one size — the largest picture’s', () => {
    const small = { crop: { width: 640, height: 360 }, fit: 'cover' as const };
    const large = { crop: { width: 1280, height: 720 }, fit: 'cover' as const };
    expect(outputSizeFor('16:9', 1080, [small, large])).toMatchObject({ width: 1280, height: 720, rule: 'source' });
    expect(outputSizeFor('16:9', 1080, [small])).toMatchObject({ width: 640, height: 360, rule: 'source' });
  });

  it('the two floors: 144 px for any frame, 360 px with subtitles burned in — and neither lifts a frame over the limit', () => {
    const tiny = { crop: { width: 160, height: 90 }, fit: 'cover' as const };
    expect(MIN_OUTPUT_SHORT_EDGE).toBe(144);
    expect(MIN_CAPTION_SHORT_EDGE).toBe(360);
    expect(outputSizeFor('16:9', 1080, [tiny])).toMatchObject({ width: 256, height: 144, rule: 'floor' });
    expect(outputSizeFor('16:9', 1080, [{ crop: { width: 256, height: 144 }, fit: 'cover' }])).toMatchObject({ width: 256, height: 144, rule: 'source' });
    const p240 = { crop: { width: 426, height: 240 }, fit: 'cover' as const };
    expect(outputSizeFor('16:9', 1080, [p240])).toMatchObject({ width: 426, height: 240, rule: 'source' });
    expect(outputSizeFor('16:9', 1080, [p240], { captions: true })).toMatchObject({ width: 640, height: 360, rule: 'floor' });
    // 360p and up: subtitles change nothing.
    const p480 = { crop: { width: 854, height: 480 }, fit: 'cover' as const };
    expect(outputSizeFor('16:9', 1080, [p480], { captions: true })).toMatchObject({ width: 854, height: 480 });
    // A limit under the floor wins (the recipe allows any positive number).
    expect(outputSizeFor('16:9', 100, [tiny])).toMatchObject({ shortEdge: 100, rule: 'floor' });
  });

  it('without a picture to measure the limit itself is the size (an empty plan, unknown source size)', () => {
    expect(outputSizeFor('16:9', 1080, [])).toMatchObject({ width: 1920, height: 1080, rule: 'ceiling' });
    expect(outputSizeFor('9:16', 720, [{ crop: { width: 0, height: 0 }, fit: 'cover' }])).toMatchObject({ width: 720, height: 1280, rule: 'ceiling' });
    expect(nativeShortEdge({ width: 1280, height: 720, segments: [] })).toBeNull();
  });
});
