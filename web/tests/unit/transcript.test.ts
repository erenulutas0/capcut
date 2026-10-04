import { describe, expect, it } from 'vitest';

import {
  addKesitlerFromRanges,
  applyTranscriptTrack,
  createEmptyProject,
  importCaptionTrack,
  setVideoAsset,
  addCaptionCue,
  convertCaptionTimeBase,
  withWholeKesit,
} from '@/application/commands';
import { CAPTION_LIMITS, outputCues, primaryCaptionTrack } from '@/domain/captions';
import type { AssetV1, Project } from '@/domain/edl';
import { loadProject } from '@/domain/migration';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import {
  KESIT_LEAD_US,
  TRANSCRIPT_GUARD,
  activeLineIndex,
  buildSegment,
  kesitRangesFromLines,
  lineClock,
  spanVerdict,
  transcriptLines,
  transcriptText,
  wordsOnSourceClock,
} from '@/domain/transcript';
import { issueCodes, validateProject } from '@/domain/validation';

const S = US_PER_SECOND;
const OFFSET = { startUs: 190_000, endUs: 200_000 };

describe('the guard: keep the text, or show "(anlaşılamadı)"', () => {
  it('uses the thresholds the spike fixed before its validation clips', () => {
    expect(TRANSCRIPT_GUARD).toEqual({ minAvgLogprob: -0.75, maxCompressionRatio: 2.4 });
  });

  it('keeps ordinary speech (the lowest real span in the spike was -0.51)', () => {
    expect(spanVerdict({ text: ' He hoped there would be stew for dinner.', avgLogprob: -0.51, compressionRatio: 0.9 })).toBe('ok');
    expect(spanVerdict({ text: 'August.', avgLogprob: -0.749, compressionRatio: 0.5 })).toBe('ok');
  });

  it('drops what the recogniser was unsure of (the invented lines sat at -0.95 and below)', () => {
    expect(spanVerdict({ text: ' Thank you.', avgLogprob: -0.95, compressionRatio: 0.6 })).toBe('unclear');
    expect(spanVerdict({ text: " I'm sorry.", avgLogprob: -0.751, compressionRatio: 0.6 })).toBe('unclear');
    // Exactly at the threshold is kept: the rule is "under -0.75".
    expect(spanVerdict({ text: 'you', avgLogprob: -0.75, compressionRatio: 0.3 })).toBe('ok');
  });

  it('drops a repetition loop even when the recogniser was sure of it', () => {
    // The spike's music loop: mean log-probability -0.09, zlib ratio 7.5.
    expect(spanVerdict({ text: "I'm not a bad guy, ".repeat(40), avgLogprob: -0.09, compressionRatio: 7.5 })).toBe('unclear');
    expect(spanVerdict({ text: 'a real sentence', avgLogprob: -0.2, compressionRatio: 2.4 })).toBe('ok');
    expect(spanVerdict({ text: 'a real sentence', avgLogprob: -0.2, compressionRatio: 2.41 })).toBe('unclear');
  });

  it('text with no letter or digit is not text', () => {
    expect(spanVerdict({ text: '', avgLogprob: null, compressionRatio: null })).toBe('unclear');
    expect(spanVerdict({ text: ' . ', avgLogprob: -0.1, compressionRatio: 0.2 })).toBe('unclear');
    expect(spanVerdict({ text: '…!', avgLogprob: -0.1, compressionRatio: 0.2 })).toBe('unclear');
    expect(spanVerdict({ text: '25', avgLogprob: -0.1, compressionRatio: 0.2 })).toBe('ok');
  });

  it('a dropped span stays in the transcript as an unclear segment, with no words', () => {
    const segment = buildSegment(
      { start: 12.5, end: 14.25 },
      [{ text: ' Thank', start: 0.2, end: 0.6 }, { text: ' you.', start: 0.6, end: 1 }],
      { text: ' Thank you.', avgLogprob: -1.13, compressionRatio: 0.7 },
      OFFSET,
    );
    expect(segment).toEqual({ startUs: 12_500_000, endUs: 14_250_000, state: 'unclear', words: [] });
  });

  it('kept text without a single timed word is unclear too, never placed by guessing', () => {
    const segment = buildSegment({ start: 1, end: 2 }, [{ text: ' hello', start: null, end: null }], { text: ' hello', avgLogprob: -0.2, compressionRatio: 0.5 }, OFFSET);
    expect(segment.state).toBe('unclear');
  });
});

describe('word times on the source clock, the constant lateness taken out', () => {
  const span = { start: 10, end: 14 };

  it('moves span-relative seconds to source microseconds and subtracts the per-model constants', () => {
    const words = wordsOnSourceClock(span, [{ text: ' However,', start: 1, end: 1.5 }, { text: ' due', start: 1.5, end: 1.8 }], OFFSET);
    expect(words).toEqual([
      { startUs: 10_810_000, endUs: 11_300_000, text: 'However,' },
      { startUs: 11_310_000, endUs: 11_600_000, text: 'due' },
    ]);
  });

  it('never leaves the span and never runs backwards', () => {
    const words = wordsOnSourceClock(
      span,
      [
        { text: ' a', start: 0.05, end: 0.1 },
        { text: ' b', start: 0.1, end: 0.15 },
        { text: ' c', start: 3.9, end: 5 },
      ],
      OFFSET,
    );
    expect(words[0]).toEqual({ startUs: 10_000_000, endUs: 10_000_000, text: 'a' });
    expect(words[1]!.startUs).toBeGreaterThanOrEqual(words[0]!.startUs);
    expect(words[2]!.endUs).toBe(14_000_000);
    for (const word of words) {
      expect(word.startUs).toBeGreaterThanOrEqual(10_000_000);
      expect(word.endUs).toBeLessThanOrEqual(14_000_000);
      expect(word.endUs).toBeGreaterThanOrEqual(word.startUs);
      expect(Number.isInteger(word.startUs) && Number.isInteger(word.endUs)).toBe(true);
    }
  });

  it('a word without an end runs to the end of its span; empty words are skipped', () => {
    const words = wordsOnSourceClock(span, [{ text: '  ', start: 0.5, end: 0.6 }, { text: ' last', start: 3, end: null }], OFFSET);
    expect(words).toEqual([{ startUs: 12_810_000, endUs: 14_000_000, text: 'last' }]);
  });
});

const video: AssetV1 = { assetId: 'a_video_001', kind: 'video', durationUs: 120 * S, displayWidth: 1920, displayHeight: 1080, hasAudio: true };
/** A video with the whole of it as one kesit (a recipe without a kesit is not a valid stored recipe). */
const baseProject = (): Project => {
  const whole = withWholeKesit(setVideoAsset(createEmptyProject(), video));
  if (!whole.ok) throw new Error('no whole kesit');
  return whole.project;
};
const emptyProject = (): Project => setVideoAsset(createEmptyProject(), video);

const CUES = [
  { startUs: 1 * S, endUs: 3 * S, text: 'He hoped there would be\nstew for dinner,' },
  { startUs: 3 * S, endUs: 5 * S, text: 'turnips and carrots.' },
  { startUs: 9 * S, endUs: 11 * S, text: 'A second thought.' },
  { startUs: 30 * S, endUs: 33 * S, text: 'Much later.' },
];
const UNCLEAR = [{ startUs: 15 * S, endUs: 18 * S }];

describe('the transcript as a caption track (one data shape)', () => {
  it('becomes a source-anchored English track with origin "transcript" and its unclear spans', () => {
    const result = applyTranscriptTrack(baseProject(), CUES, UNCLEAR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const track = primaryCaptionTrack(result.project)!;
    expect(track).toMatchObject({ origin: 'transcript', timeBase: 'source', assetId: 'a_video_001', language: 'en' });
    expect(track.cues.map((cue) => cue.text)).toEqual(CUES.map((cue) => cue.text));
    expect(track.unclear).toEqual(UNCLEAR);
    expect(result.report).toEqual({ imported: 4, skipped: [] });
    expect(validateProject(result.project).ok).toBe(true);
    // One undo step.
    expect(result.project.revision).toBe(baseProject().revision + 1);
  });

  it('feeds the same output mapping as any source track (burn-in, SRT/VTT)', () => {
    const applied = applyTranscriptTrack(baseProject(), CUES, UNCLEAR);
    if (!applied.ok) throw new Error('apply failed');
    const whole = { ok: true as const, project: applied.project };
    expect(outputCues(whole.project).map((cue) => [cue.startUs, cue.endUs])).toEqual(CUES.map((cue) => [cue.startUs, cue.endUs]));
    const plan = compileRenderPlan(whole.project, WEB_LOCAL_POLICY);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.plan.captions?.cues).toHaveLength(4);
  });

  it('keeps a transcript that has only unclear spans; refuses one with nothing at all', () => {
    const onlyUnclear = applyTranscriptTrack(baseProject(), [], UNCLEAR);
    expect(onlyUnclear.ok).toBe(true);
    if (onlyUnclear.ok) {
      expect(primaryCaptionTrack(onlyUnclear.project)).toMatchObject({ origin: 'transcript', cues: [], unclear: UNCLEAR });
      expect(validateProject(onlyUnclear.project).ok).toBe(true);
    }
    expect(applyTranscriptTrack(baseProject(), [], [])).toMatchObject({ ok: false, reason: 'caption_import_empty' });
    expect(applyTranscriptTrack(createEmptyProject(), CUES, [])).toMatchObject({ ok: false, reason: 'caption_no_video' });
  });

  it('cleans the unclear spans: sorted, merged, inside the video', () => {
    const result = applyTranscriptTrack(baseProject(), CUES, [
      { startUs: 50 * S, endUs: 52 * S },
      { startUs: 40 * S, endUs: 45 * S },
      { startUs: 44 * S, endUs: 47 * S },
      { startUs: 119 * S, endUs: 130 * S },
      { startUs: 60 * S, endUs: 60 * S },
    ]);
    if (!result.ok) throw new Error('apply failed');
    expect(primaryCaptionTrack(result.project)!.unclear).toEqual([
      { startUs: 40 * S, endUs: 47 * S },
      { startUs: 50 * S, endUs: 52 * S },
      { startUs: 119 * S, endUs: 120 * S },
    ]);
  });

  it('skips and counts a line that breaks a rule, like a subtitle file', () => {
    const result = applyTranscriptTrack(baseProject(), [...CUES, { startUs: 32 * S, endUs: 34 * S, text: 'overlaps' }, { startUs: 50 * S, endUs: 50 * S + 100_000, text: 'flash' }], []);
    if (!result.ok) throw new Error('apply failed');
    expect(result.report.imported).toBe(4);
    expect(result.report.skipped.map((item) => item.reason).sort()).toEqual(['caption_cue_overlap', 'caption_cue_too_short']);
  });

  it('a subtitle file imported afterwards replaces the transcript and its unclear spans', () => {
    const applied = applyTranscriptTrack(baseProject(), CUES, UNCLEAR);
    if (!applied.ok) throw new Error('apply failed');
    const imported = importCaptionTrack(applied.project, [{ startUs: 0, endUs: S, text: 'dosyadan' }], 'source');
    if (!imported.ok) throw new Error('import failed');
    const track = primaryCaptionTrack(imported.project)!;
    expect(track.origin).toBe('imported');
    expect(track.unclear).toBeUndefined();
    expect(validateProject(imported.project).ok).toBe(true);
  });

  it('re-anchoring to the output drops the unclear spans (they are ranges of the file)', () => {
    const applied = applyTranscriptTrack(baseProject(), CUES, UNCLEAR);
    if (!applied.ok) throw new Error('apply failed');
    const whole = { project: applied.project };
    const converted = convertCaptionTimeBase(whole.project, 'output');
    if (!converted.ok) throw new Error('conversion failed');
    expect(primaryCaptionTrack(converted.project)!.unclear).toBeUndefined();
    expect(validateProject(converted.project).ok).toBe(true);
  });

  it('holds a two-hour talk: the line limit is 3000', () => {
    expect(CAPTION_LIMITS.maxCuesPerTrack).toBe(3000);
    const many = Array.from({ length: 3001 }, (_, i) => ({ startUs: i * 2 * S, endUs: i * 2 * S + S, text: `line ${i}` }));
    const long: AssetV1 = { ...video, durationUs: 7000 * S };
    const result = applyTranscriptTrack(setVideoAsset(createEmptyProject(), long), many, []);
    if (!result.ok) throw new Error('apply failed');
    expect(result.report.imported).toBe(3000);
    expect(result.report.skipped).toEqual([{ index: 3000, reason: 'caption_limit_exceeded' }]);
  });
});

describe('schema v3: validation and old recipes', () => {
  const transcriptProject = (): Project => {
    const result = applyTranscriptTrack(baseProject(), CUES, UNCLEAR);
    if (!result.ok) throw new Error('apply failed');
    return result.project;
  };
  const withTrack = (patch: Record<string, unknown>): unknown => {
    const project = transcriptProject();
    return { ...project, captionTracks: [{ ...project.captionTracks[0], ...patch }] };
  };

  it('refuses unclear spans on a track that is not a source transcript', () => {
    expect(issueCodes(validateProject(withTrack({ origin: 'manual' })))).toContain('caption_track_invalid');
    expect(issueCodes(validateProject(withTrack({ origin: 'imported' })))).toContain('caption_track_invalid');
    expect(issueCodes(validateProject(withTrack({ unclear: 'yes' })))).toContain('caption_track_invalid');
  });

  it('refuses unclear spans that are reversed, out of order, past the video or not integers', () => {
    expect(issueCodes(validateProject(withTrack({ unclear: [{ startUs: 5 * S, endUs: 4 * S }] })))).toContain('range_reversed');
    expect(issueCodes(validateProject(withTrack({ unclear: [{ startUs: 5 * S, endUs: 8 * S }, { startUs: 7 * S, endUs: 9 * S }] })))).toContain('caption_cue_overlap');
    expect(issueCodes(validateProject(withTrack({ unclear: [{ startUs: 119 * S, endUs: 121 * S }] })))).toContain('range_out_of_source');
    expect(issueCodes(validateProject(withTrack({ unclear: [{ startUs: 1.5, endUs: 3 * S }] })))).toContain('time_not_safe_integer');
    expect(issueCodes(validateProject(withTrack({ unclear: [{ startUs: S, endUs: 2 * S, note: 'x' }] })))).toContain('unknown_field');
  });

  it('refuses an origin it does not know', () => {
    expect(issueCodes(validateProject(withTrack({ origin: 'cloud', unclear: undefined })))).toContain('caption_track_invalid');
  });

  it('a v2 recipe opens unchanged apart from the number (lossless)', () => {
    const added = addCaptionCue(baseProject(), { startUs: S, endUs: 3 * S, text: 'elle yazıldı' });
    if (!added.ok) throw new Error('add failed');
    const v2 = { ...added.project, schemaVersion: 2 };
    expect(validateProject(v2).ok).toBe(false);
    const loaded = loadProject(v2);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.project.schemaVersion).toBe(3);
      expect({ ...loaded.project, schemaVersion: 2 }).toEqual(v2);
    }
  });

  it('does not accept a later schema it cannot know', () => {
    expect(issueCodes(loadProject({ ...baseProject(), schemaVersion: 4 }))).toContain('schema_version_unsupported');
  });
});

describe('the panel\'s lines', () => {
  const track = () => primaryCaptionTrack((applyTranscriptTrack(baseProject(), CUES, UNCLEAR) as { ok: true; project: Project }).project)!;

  it('lists lines and unclear spans in time order', () => {
    const lines = transcriptLines(track());
    expect(lines.map((line) => [line.kind, line.startUs / S])).toEqual([
      ['cue', 1],
      ['cue', 3],
      ['cue', 9],
      ['unclear', 15],
      ['cue', 30],
    ]);
    expect(transcriptLines(undefined)).toEqual([]);
  });

  it('an unclear span a line was typed over is not listed twice', () => {
    const typed = { ...track(), cues: [...track().cues, { cueId: 'q_900', startUs: 15 * S, endUs: 18 * S, text: 'elle yazdım' }] };
    expect(transcriptLines(typed).filter((line) => line.kind === 'unclear')).toEqual([]);
  });

  it('the active line is the last one that has started', () => {
    const lines = transcriptLines(track());
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 1 * S)).toBe(0);
    expect(activeLineIndex(lines, 4 * S)).toBe(1);
    expect(activeLineIndex(lines, 7 * S)).toBe(1);
    expect(activeLineIndex(lines, 16 * S)).toBe(3);
    expect(activeLineIndex(lines, 119 * S)).toBe(4);
  });

  it('writes the text file with time stamps and the unclear spans in words', () => {
    const text = transcriptText(transcriptLines(track()), '(anlaşılamadı)', 'Otomatik yazıldı');
    expect(text.split('\r\n')).toEqual([
      'Otomatik yazıldı',
      '',
      '[00:01] He hoped there would be stew for dinner,',
      '[00:03] turnips and carrots.',
      '[00:09] A second thought.',
      '[00:15] (anlaşılamadı)',
      '[00:30] Much later.',
      '',
    ]);
    expect(lineClock(75 * S)).toBe('1:15');
    expect(lineClock(3723 * S)).toBe('1:02:03');
  });
});

describe('cut by text: kesitler from selected lines', () => {
  const lines = () => transcriptLines(primaryCaptionTrack((applyTranscriptTrack(baseProject(), CUES, UNCLEAR) as { ok: true; project: Project }).project)!);
  const keys = (...indexes: number[]) => new Set(indexes.map((index) => lines()[index]!.key));

  it('one line: its own range with a short lead before the first word', () => {
    expect(kesitRangesFromLines(lines(), keys(2), 120 * S)).toEqual([{ sourceInUs: 9 * S - KESIT_LEAD_US, sourceOutUs: 11 * S }]);
  });

  it('neighbouring lines become one kesit; lines apart become two', () => {
    expect(kesitRangesFromLines(lines(), keys(0, 1), 120 * S)).toEqual([{ sourceInUs: S - KESIT_LEAD_US, sourceOutUs: 5 * S }]);
    expect(kesitRangesFromLines(lines(), keys(0, 2), 120 * S)).toEqual([
      { sourceInUs: S - KESIT_LEAD_US, sourceOutUs: 3 * S },
      { sourceInUs: 9 * S - KESIT_LEAD_US, sourceOutUs: 11 * S },
    ]);
  });

  it('neighbours in the list are joined across the pause between them', () => {
    // Lines 1 and 2 are next to each other in the list, 4 s apart in time: one kesit, pause included.
    expect(kesitRangesFromLines(lines(), keys(1, 2), 120 * S)).toEqual([{ sourceInUs: 3 * S - KESIT_LEAD_US, sourceOutUs: 11 * S }]);
  });

  it('an unclear span can be selected too; nothing leaves the video', () => {
    expect(kesitRangesFromLines(lines(), keys(3), 120 * S)).toEqual([{ sourceInUs: 15 * S - KESIT_LEAD_US, sourceOutUs: 18 * S }]);
    const early = [{ kind: 'cue' as const, key: 'a', cueId: 'a', startUs: 50_000, endUs: 2 * S, text: 'x' }];
    expect(kesitRangesFromLines(early, new Set(['a']), S)).toEqual([{ sourceInUs: 0, sourceOutUs: S }]);
    expect(kesitRangesFromLines(lines(), new Set(), 120 * S)).toEqual([]);
  });

  it('adds every range as a kesit in one step, in order', () => {
    const project = (applyTranscriptTrack(emptyProject(), CUES, UNCLEAR) as { ok: true; project: Project }).project;
    const ranges = kesitRangesFromLines(lines(), keys(0, 2, 4), 120 * S);
    const result = addKesitlerFromRanges(project, ranges);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(3);
    expect(result.project.clips.map((clip) => [clip.sourceInUs, clip.sourceOutUs])).toEqual(ranges.map((range) => [range.sourceInUs, range.sourceOutUs]));
    expect(result.project.revision).toBe(project.revision + 1);
    expect(validateProject(result.project).ok).toBe(true);
    // The lines travel with the picture: each kesit shows its own line.
    expect(outputCues(result.project).map((cue) => cue.text)).toEqual([CUES[0]!.text, CUES[2]!.text, CUES[3]!.text]);
  });

  it('all or none: over the kesit limit nothing is added and the room is said', () => {
    const project = emptyProject();
    const ranges = Array.from({ length: 21 }, (_, i) => ({ sourceInUs: i * 2 * S, sourceOutUs: i * 2 * S + S }));
    expect(addKesitlerFromRanges(project, ranges)).toEqual({ ok: false, reason: 'clip_limit_exceeded', room: 20, wanted: 21 });
    expect(addKesitlerFromRanges(project, [])).toEqual({ ok: false, reason: 'nothing_selected' });
    expect(addKesitlerFromRanges(project, [{ sourceInUs: 0, sourceOutUs: 50_000 }])).toEqual({ ok: false, reason: 'clip_too_short' });
  });
});
