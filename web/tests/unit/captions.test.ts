import { describe, expect, it } from 'vitest';

import {
  addCaptionCue,
  addClip,
  createEmptyProject,
  removeCaptionCue,
  removeClip,
  setCaptionLanguage,
  setCaptionStyle,
  setVideoAsset,
  updateCaptionCue,
} from '@/application/commands';
import { redo, undo, commit, initHistory } from '@/application/history';
import { layoutCaption, wrapCaptionText, type MeasureText } from '@/domain/captionLayout';
import {
  CAPTION_LIMITS,
  activeCueAt,
  cueVisibility,
  normalizeCaptionText,
} from '@/domain/captions';
import type { AssetV1, Project } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { validateProject } from '@/domain/validation';

const S = US_PER_SECOND;
const LF = String.fromCharCode(10);

const video: AssetV1 = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 24 * S,
  displayWidth: 1920,
  displayHeight: 1080,
  hasAudio: true,
};

/** A project whose output is `seconds` long, from one moment. */
function projectOf(seconds: number): Project {
  const withVideo = setVideoAsset(createEmptyProject(), video);
  const result = addClip(withVideo, { sourceInUs: 0, sourceOutUs: seconds * S });
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

function add(project: Project, from: number, to: number, text: string): Project {
  const result = addCaptionCue(project, { startUs: from * S, endUs: to * S, text });
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

/** Monospace stand-in for a font: every code point is 0.5 em wide. */
const mono: MeasureText = (text, fontPx) => Array.from(text).length * fontPx * 0.5;

describe('normalizeCaptionText', () => {
  it('collapses spaces, trims lines, unifies line breaks and drops empty lines', () => {
    const CR = String.fromCharCode(13);
    const TAB = String.fromCharCode(9);
    expect(normalizeCaptionText(`  merhaba${TAB}  dünya ${CR}${LF}${LF}  ikinci   satır `)).toBe(
      `merhaba dünya${LF}ikinci satır`,
    );
  });

  it('removes control and zero-width characters but keeps Turkish letters and emoji', () => {
    const hidden = String.fromCharCode(0x200b, 0x0007, 0xfeff);
    expect(normalizeCaptionText(`İğ${hidden}şÇ ✨`)).toBe('İğşÇ ✨');
  });

  it('is idempotent', () => {
    const once = normalizeCaptionText(`  a  b ${LF} c `);
    expect(normalizeCaptionText(once)).toBe(once);
  });
});

describe('caption commands', () => {
  it('adds a cue, creates the track with defaults and stays valid', () => {
    const project = add(projectOf(10), 1, 3, '  Merhaba   dünya ');
    const track = project.captionTracks[0];
    expect(track).toMatchObject({ trackId: 't_001', origin: 'manual', timeBase: 'output', language: 'tr' });
    expect(track?.cues).toEqual([{ cueId: 'q_001', startUs: 1 * S, endUs: 3 * S, text: 'Merhaba dünya' }]);
    expect(validateProject(project).ok).toBe(true);
  });

  it('keeps cues sorted and assigns stable ids', () => {
    let project = add(projectOf(10), 5, 6, 'ikinci');
    project = add(project, 1, 2, 'birinci');
    expect(project.captionTracks[0]?.cues.map((cue) => [cue.cueId, cue.text])).toEqual([
      ['q_002', 'birinci'],
      ['q_001', 'ikinci'],
    ]);
  });

  it('refuses overlap, empty text, too long text, three lines and too short cues', () => {
    const project = add(projectOf(10), 1, 3, 'var');
    const attempt = (from: number, to: number, text: string) =>
      addCaptionCue(project, { startUs: from * S, endUs: to * S, text });
    expect(attempt(2, 4, 'çakışan')).toEqual({ ok: false, reason: 'caption_cue_overlap' });
    expect(attempt(4, 5, '   ')).toEqual({ ok: false, reason: 'caption_text_empty' });
    expect(attempt(4, 5, 'a'.repeat(CAPTION_LIMITS.maxTextChars + 1))).toEqual({
      ok: false,
      reason: 'caption_text_too_long',
    });
    expect(attempt(4, 5, ['a', 'b', 'c'].join(LF))).toEqual({ ok: false, reason: 'caption_too_many_lines' });
    expect(attempt(4, 4.1, 'kısa')).toEqual({ ok: false, reason: 'caption_cue_too_short' });
    // Touching is not overlapping: [1,3) and [3,4) share no instant.
    expect(attempt(3, 4, 'bitişik').ok).toBe(true);
  });

  it('counts emoji as one character each', () => {
    const emoji = '✨'.repeat(CAPTION_LIMITS.maxTextChars);
    expect(addCaptionCue(projectOf(10), { startUs: 0, endUs: S, text: emoji }).ok).toBe(true);
  });

  it('refuses a start outside the output and cuts an end past it', () => {
    const project = projectOf(4);
    expect(addCaptionCue(project, { startUs: 4 * S, endUs: 5 * S, text: 'dışarıda' })).toEqual({
      ok: false,
      reason: 'caption_outside_output',
    });
    const result = addCaptionCue(project, { startUs: 3 * S, endUs: 9 * S, text: 'sona kadar' });
    expect(result.ok && result.project.captionTracks[0]?.cues[0]?.endUs).toBe(4 * S);
  });

  it('updates text and times, and refuses an update into another cue', () => {
    let project = add(projectOf(10), 1, 2, 'bir');
    project = add(project, 5, 6, 'iki');
    const moved = updateCaptionCue(project, 'q_001', { startUs: 2 * S, endUs: 4 * S, text: 'bir!' });
    expect(moved.ok && moved.project.captionTracks[0]?.cues[0]).toEqual({
      cueId: 'q_001',
      startUs: 2 * S,
      endUs: 4 * S,
      text: 'bir!',
    });
    expect(updateCaptionCue(project, 'q_001', { endUs: 5.5 * S })).toEqual({
      ok: false,
      reason: 'caption_cue_overlap',
    });
    expect(updateCaptionCue(project, 'q_999', { text: 'yok' })).toEqual({ ok: false, reason: 'caption_not_found' });
    // No change -> same object, so history does not record a no-op step.
    const same = updateCaptionCue(project, 'q_001', { text: ' bir ' });
    expect(same.ok && same.project).toBe(project);
  });

  it('removes a cue and changes style and language as single steps', () => {
    let project = add(projectOf(10), 1, 2, 'bir');
    const revision = project.revision;
    project = setCaptionStyle(project, { preset: 'outline', position: 'top' });
    expect(project.captionTracks[0]?.style).toEqual({ preset: 'outline', position: 'top', size: 'medium' });
    expect(project.revision).toBe(revision + 1);
    expect(setCaptionStyle(project, { preset: 'outline' })).toBe(project);
    project = setCaptionLanguage(project, 'en');
    expect(project.captionTracks[0]?.language).toBe('en');
    expect(setCaptionLanguage(project, 'english!')).toBe(project);
    project = removeCaptionCue(project, 'q_001');
    expect(project.captionTracks[0]?.cues).toEqual([]);
    expect(validateProject(project).ok).toBe(true);
  });

  it('undo and redo restore caption edits', () => {
    const start = projectOf(10);
    let history = initHistory(start);
    history = commit(history, add(history.present, 1, 2, 'bir'));
    history = undo(history);
    expect(history.present.captionTracks).toEqual([]);
    history = redo(history);
    expect(history.present.captionTracks[0]?.cues).toHaveLength(1);
  });
});

describe('caption timing against the output', () => {
  it('finds the visible cue with half-open ranges', () => {
    const project = add(add(projectOf(10), 1, 2, 'bir'), 2, 3, 'iki');
    expect(activeCueAt(project, 0.999 * S)).toBeUndefined();
    expect(activeCueAt(project, 1 * S)?.text).toBe('bir');
    expect(activeCueAt(project, 2 * S)?.text).toBe('iki');
    expect(activeCueAt(project, 3 * S)).toBeUndefined();
  });

  it('reports cues the moments no longer reach, instead of dropping them', () => {
    let project = add(projectOf(4), 3, 4, 'son');
    const second = addClip(project, { sourceInUs: 10 * S, sourceOutUs: 14 * S });
    if (!second.ok) throw new Error(second.reason);
    project = add(second.project, 6, 8, 'sonraki');
    const late = project.captionTracks[0]?.cues[1];
    if (!late) throw new Error('missing cue');
    expect(cueVisibility(late, 8 * S)).toBe('visible');
    // Remove the second moment: the output is 4 s again.
    const firstClip = project.clips[1];
    if (!firstClip) throw new Error('missing clip');
    project = removeClip(project, firstClip.clipId);
    expect(cueVisibility(late, 4 * S)).toBe('outside');
    expect(validateProject(project).ok).toBe(true);
    expect(project.captionTracks[0]?.cues).toHaveLength(2);
  });

  it('puts cues on the output frame grid, cut at the end, in the fingerprint', () => {
    const base = projectOf(4);
    const withCaptions = add(add(base, 0.5, 1.5, 'bir'), 3.5, 3.99, 'kesilen');
    const plain = compileRenderPlan(base, WEB_LOCAL_POLICY);
    const plan = compileRenderPlan(withCaptions, WEB_LOCAL_POLICY);
    if (!plan.ok || !plain.ok) throw new Error('plan failed');
    expect(plain.plan.captions).toBeNull();
    expect(plan.plan.captions?.cues).toEqual([
      { cueId: 'q_001', startFrame: 15, endFrame: 45, text: 'bir' },
      { cueId: 'q_002', startFrame: 105, endFrame: 120, text: 'kesilen' },
    ]);
    expect(plan.plan.fingerprint).not.toBe(plain.plan.fingerprint);

    const restyled = compileRenderPlan(setCaptionStyle(withCaptions, { size: 'large' }), WEB_LOCAL_POLICY);
    expect(restyled.ok && restyled.plan.fingerprint).not.toBe(plan.plan.fingerprint);
  });
});

describe('caption layout', () => {
  const frame916 = { width: 1080, height: 1920, aspect: '9:16' as const };
  const style = { preset: 'box' as const, position: 'bottom' as const, size: 'medium' as const };

  it('wraps greedily and splits an over-long word by code point', () => {
    expect(wrapCaptionText('bir iki üç dört', 4 * 5, 10, mono)).toEqual(['bir', 'iki', 'üç', 'dört']);
    expect(wrapCaptionText('bir iki', 100, 10, mono)).toEqual(['bir iki']);
    expect(wrapCaptionText('çokuzunkelime', 5 * 5, 10, mono)).toEqual(['çokuz', 'unkel', 'ime']);
  });

  it('centres the box and keeps it inside the vertical safe area', () => {
    const result = layoutCaption('Merhaba dünya', style, frame916, mono);
    if (!result.ok) throw new Error('did not fit');
    const { box, fontPx, lines } = result.layout;
    expect(fontPx).toBe(Math.round(1080 * 0.052));
    expect(box.x + box.width / 2).toBeCloseTo(540, 0);
    // 9:16 keeps 16% free at the bottom for app overlays.
    expect(box.y + box.height).toBeLessThanOrEqual(Math.round(1920 * 0.84));
    expect(lines).toHaveLength(1);
    expect([box.x, box.y, box.width, box.height, fontPx].every(Number.isInteger)).toBe(true);
  });

  it('places top and middle captions as asked', () => {
    const top = layoutCaption('a', { ...style, position: 'top' }, frame916, mono);
    const middle = layoutCaption('a', { ...style, position: 'middle' }, frame916, mono);
    if (!top.ok || !middle.ok) throw new Error('did not fit');
    expect(top.layout.box.y).toBe(Math.round(1920 * 0.1));
    expect(Math.abs(middle.layout.box.y + middle.layout.box.height / 2 - 960)).toBeLessThanOrEqual(1);
  });

  it('keeps an explicit line break and refuses what would need a third line', () => {
    const two = layoutCaption(`bir${LF}iki`, style, frame916, mono);
    expect(two.ok && two.layout.lines.map((line) => line.text)).toEqual(['bir', 'iki']);
    const long = 'kelime '.repeat(40).trim();
    expect(layoutCaption(long, style, frame916, mono)).toEqual({ ok: false, reason: 'caption_does_not_fit' });
  });

  it('scales with the frame so preview and export agree in proportion', () => {
    const big = layoutCaption('aynı metin', style, frame916, mono);
    const small = layoutCaption('aynı metin', style, { width: 360, height: 640, aspect: '9:16' }, mono);
    if (!big.ok || !small.ok) throw new Error('did not fit');
    // Whole-pixel rounding: 56 px vs 19 px is 2.95, within one pixel of 3x.
    expect(Math.abs(big.layout.fontPx - 3 * small.layout.fontPx)).toBeLessThanOrEqual(3);
    expect(big.layout.box.y / 1920).toBeCloseTo(small.layout.box.y / 640, 2);
  });
});
