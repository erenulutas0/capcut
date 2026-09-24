import { describe, expect, it } from 'vitest';

import {
  addCaptionCue,
  addClip,
  convertCaptionTimeBase,
  createEmptyProject,
  importCaptionTrack,
  moveClip,
  setVideoAsset,
  shiftCaptions,
  updateClipRange,
} from '@/application/commands';
import {
  activeCueAt,
  outputCues,
  outputCuesForExport,
  sourceCueUsage,
  suggestTimeBase,
  trackTimeAtOutput,
} from '@/domain/captions';
import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { validateProject } from '@/domain/validation';

const S = US_PER_SECOND;

const video: AssetV1 = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 20 * S,
  displayWidth: 1920,
  displayHeight: 1080,
  hasAudio: true,
};

function withMoments(ranges: Array<[number, number]>): Project {
  let project = setVideoAsset(createEmptyProject(), video);
  for (const [from, to] of ranges) {
    const result = addClip(project, { sourceInUs: from * S, sourceOutUs: to * S });
    if (!result.ok) throw new Error(result.reason);
    project = result.project;
  }
  return project;
}

/**
 * An empty track on the output clock (the joined download). Since ADR-026 a
 * new track is anchored to the video; these tests are about output lines.
 */
function withOutputTrack(project: Project): Project {
  return {
    ...project,
    captionTracks: [
      { trackId: 't_001', origin: 'manual', timeBase: 'output', language: 'tr', style: { preset: 'box', position: 'bottom', size: 'medium' }, cues: [] },
    ],
  };
}

function importSource(project: Project, cues: Array<[number, number, string]>): Project {
  const result = importCaptionTrack(
    project,
    cues.map(([from, to, text]) => ({ startUs: from * S, endUs: to * S, text })),
    'source',
  );
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

const seconds = (cues: ReturnType<typeof outputCues>) =>
  cues.map((cue) => [cue.cueId, cue.occurrence, cue.startUs / S, cue.endUs / S]);

describe('source-anchored captions follow their moments', () => {
  // Source: [1,3) "baş", [9,13) "orta". Moments: 8–14 then 0–4 (reordered).
  const base = importSource(withMoments([[8, 14], [0, 4]]), [
    [1, 3, 'baş'],
    [9, 13, 'orta'],
    [15, 19, 'kullanılmayan'],
  ]);

  it('maps each cue to where its picture is in the output (O + (t - S))', () => {
    expect(validateProject(base).ok).toBe(true);
    // Moment 8–14 plays at output 0–6: 9–13 → 1–5. Moment 0–4 plays at 6–10: 1–3 → 7–9.
    expect(seconds(outputCues(base))).toEqual([
      ['q_002', 0, 1, 5],
      ['q_001', 0, 7, 9],
    ]);
    expect(activeCueAt(base, 7.5 * S)?.text).toBe('baş');
  });

  it('moves the captions when moments are reordered, without touching the track', () => {
    const swapped = moveClip(base, base.clips[1]?.clipId ?? '', -1);
    expect(swapped.captionTracks).toEqual(base.captionTracks);
    expect(seconds(outputCues(swapped))).toEqual([
      ['q_001', 0, 1, 3],
      ['q_002', 0, 5, 9],
    ]);
  });

  it('shows a cue twice when its range is used twice, and cuts it at a moment edge', () => {
    const repeated = importSource(withMoments([[0, 4], [2, 6]]), [[1, 3, 'tekrar']]);
    // 0–4 at 0–4: 1–3 → 1–3. 2–6 at 4–8: 2–3 → 4–5 (cut by the moment start).
    expect(seconds(outputCues(repeated))).toEqual([
      ['q_001', 0, 1, 3],
      ['q_001', 1, 4, 5],
    ]);
    const cue = repeated.captionTracks[0]?.cues[0];
    if (!cue) throw new Error('missing cue');
    expect(sourceCueUsage(repeated, cue)).toEqual({ occurrences: 2, partial: true });
  });

  it('reports cues no moment reaches', () => {
    const unused = base.captionTracks[0]?.cues[2];
    if (!unused) throw new Error('missing cue');
    expect(sourceCueUsage(base, unused)).toEqual({ occurrences: 0, partial: false });
  });

  it('follows a trim of the moment', () => {
    const clipId = base.clips[0]?.clipId ?? '';
    const trimmed = updateClipRange(base, clipId, { sourceInUs: 10 * S, sourceOutUs: 14 * S });
    if (!trimmed.ok) throw new Error(trimmed.reason);
    // 10–14 at 0–4: "orta" 9–13 → 10–13 → 0–3.
    expect(seconds(outputCues(trimmed.project))[0]).toEqual(['q_002', 0, 0, 3]);
  });

  it('feeds the render plan from the same mapping', () => {
    const plan = compileRenderPlan(base, WEB_LOCAL_POLICY);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.plan.captions?.cues).toEqual([
      { cueId: 'q_002', startFrame: 30, endFrame: 150, text: 'orta' },
      { cueId: 'q_001', startFrame: 210, endFrame: 270, text: 'baş' },
    ]);
  });

  it('gives the track time playing at an output instant', () => {
    expect(trackTimeAtOutput(base, 1 * S)).toBe(9 * S);
    expect(trackTimeAtOutput(base, 6.5 * S)).toBe(0.5 * S);
  });

  it('adds typed lines on the source clock and refuses lines past the video', () => {
    const added = addCaptionCue(base, { startUs: 4 * S, endUs: 6 * S, text: 'yeni' });
    expect(added.ok).toBe(true);
    expect(addCaptionCue(base, { startUs: 20 * S, endUs: 21 * S, text: 'dışarıda' })).toEqual({
      ok: false,
      reason: 'range_out_of_source',
    });
  });
});

describe('converting between clocks keeps the current output identical', () => {
  it('output → source splits a line at a cut and joins contiguous moments', () => {
    // Output 0–4 is source 0–4, 4–8 is source 10–14, 8–12 is source 14–18.
    let project = withOutputTrack(withMoments([[0, 4], [10, 14], [14, 18]]));
    for (const [from, to, text] of [[3, 5, 'kesiği aşan'], [6, 10, 'bitişik anlar']] as const) {
      const result = addCaptionCue(project, { startUs: from * S, endUs: to * S, text });
      if (!result.ok) throw new Error(result.reason);
      project = result.project;
    }
    const before = seconds(outputCues(project)).map(([, , a, b]) => [a, b]);
    const converted = convertCaptionTimeBase(project, 'source');
    if (!converted.ok) throw new Error(converted.reason);
    expect(converted.project.captionTracks[0]).toMatchObject({ timeBase: 'source', assetId: 'a_video_001' });
    expect(converted.project.captionTracks[0]?.cues.map((cue) => [cue.startUs / S, cue.endUs / S, cue.text])).toEqual([
      [3, 4, 'kesiği aşan'],
      [10, 11, 'kesiği aşan'],
      // 6–10 spans moments 10–14 and 14–18, contiguous in the file: one line.
      [12, 16, 'bitişik anlar'],
    ]);
    expect(converted.report).toEqual({ split: 1, dropped: 0 });
    expect(validateProject(converted.project).ok).toBe(true);
    // What the viewer sees is unchanged: every piece sits edge to edge where the
    // output line was (one piece per moment it crosses).
    const after = seconds(outputCues(converted.project)).map(([, , a, b]) => [a, b]);
    expect(after).toEqual([[3, 4], [4, 5], [6, 8], [8, 10]]);
    expect(before).toEqual([[3, 5], [6, 10]]);
  });

  it('output → source refuses when two different lines would share a source instant', () => {
    // The same source 0–4 is used twice with different captions over it.
    let project = withOutputTrack(withMoments([[0, 4], [0, 4]]));
    for (const [from, to, text] of [[1, 2, 'ilk kez'], [5, 6, 'ikinci kez']] as const) {
      const result = addCaptionCue(project, { startUs: from * S, endUs: to * S, text });
      if (!result.ok) throw new Error(result.reason);
      project = result.project;
    }
    expect(convertCaptionTimeBase(project, 'source')).toEqual({
      ok: false,
      reason: 'caption_conversion_conflict',
      cueIds: ['q_001', 'q_002'],
    });
  });

  it('source → output gives each appearance its own line and drops unused ones', () => {
    const project = importSource(withMoments([[0, 4], [2, 6]]), [
      [1, 3, 'tekrar'],
      [10, 12, 'kullanılmayan'],
    ]);
    const converted = convertCaptionTimeBase(project, 'output');
    if (!converted.ok) throw new Error(converted.reason);
    const track = converted.project.captionTracks[0];
    expect(track?.timeBase).toBe('output');
    expect(track && 'assetId' in track).toBe(false);
    expect(track?.cues.map((cue) => [cue.cueId, cue.startUs / S, cue.endUs / S])).toEqual([
      ['q_001', 1, 3],
      // The unused line's id is free again after it was dropped.
      ['q_002', 4, 5],
    ]);
    expect(converted.report).toEqual({ split: 1, dropped: 1 });
    expect(validateProject(converted.project).ok).toBe(true);
  });
});

describe('shift and import', () => {
  it('shifts all lines, and refuses a shift that would push one off its clock', () => {
    const project = importSource(withMoments([[0, 10]]), [[1, 2, 'a'], [18, 19, 'b']]);
    const later = shiftCaptions(project, 0.5 * S);
    expect(later.ok && later.project.captionTracks[0]?.cues.map((cue) => cue.startUs / S)).toEqual([1.5, 18.5]);
    expect(shiftCaptions(project, 1.5 * S)).toEqual({ ok: false, reason: 'caption_shift_out_of_range' });
    expect(shiftCaptions(project, -1.5 * S)).toEqual({ ok: false, reason: 'caption_shift_out_of_range' });
  });

  it('imports what follows the rules and reports every skipped line by file position', () => {
    const project = withMoments([[0, 10]]);
    const result = importCaptionTrack(
      project,
      [
        { startUs: 1 * S, endUs: 2 * S, text: 'bir' },
        { startUs: 1.5 * S, endUs: 3 * S, text: 'çakışan' },
        { startUs: 4 * S, endUs: 4.1 * S, text: 'kısa' },
        { startUs: 5 * S, endUs: 6 * S, text: '   ' },
        { startUs: 7 * S, endUs: 30 * S, text: 'videoyu aşan' },
        { startUs: 8 * S, endUs: 7 * S, text: 'ters' },
      ],
      'source',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.report).toEqual({
      imported: 1,
      skipped: [
        { index: 1, reason: 'caption_cue_overlap' },
        { index: 2, reason: 'caption_cue_too_short' },
        { index: 3, reason: 'caption_text_empty' },
        { index: 4, reason: 'range_out_of_source' },
        { index: 5, reason: 'range_reversed' },
      ],
    });
    expect(result.project.captionTracks[0]).toMatchObject({ origin: 'imported', timeBase: 'source' });
  });

  it('keeps output-time lines past the current end, like typed lines', () => {
    const result = importCaptionTrack(withMoments([[0, 4]]), [{ startUs: 3 * S, endUs: 9 * S, text: 'uzun' }], 'output');
    if (!result.ok) throw new Error(result.reason);
    expect(result.project.captionTracks[0]?.cues[0]?.endUs).toBe(9 * S);
    expect(outputCuesForExport(result.project, 4 * S).map((cue) => cue.endUs)).toEqual([4 * S]);
  });

  it('refuses a file where no line survives', () => {
    const result = importCaptionTrack(withMoments([[0, 4]]), [{ startUs: 0, endUs: 1, text: 'x' }], 'output');
    expect(result.ok).toBe(false);
  });

  it('only hints at a time base when the timing rules one out', () => {
    expect(suggestTimeBase([{ endUs: 9 * S }], 9 * S, 20 * S, false)).toBeNull();
    expect(suggestTimeBase([{ endUs: 18 * S }], 9 * S, 20 * S, false)).toBe('source');
    expect(suggestTimeBase([{ endUs: 25 * S }], 30 * S, 20 * S, false)).toBe('output');
    expect(suggestTimeBase([{ endUs: 18 * S }], 20 * S, 20 * S, true)).toBe('same');
  });
});
