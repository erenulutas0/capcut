import { describe, expect, it } from 'vitest';

import {
  addCaptionCue,
  addClip,
  applySilenceCuts,
  createEmptyProject,
  moveClip,
  moveClipTo,
  removeClip,
  setFraming,
  setVideoAsset,
  setVideoGain,
  setVideoMuted,
  withWholeKesit,
} from '@/application/commands';
import { captionAtVideoTime, videoCues } from '@/domain/captions';
import type { AssetV1, Project } from '@/domain/edl';
import {
  DEFAULT_KESIT_SETTINGS,
  EMPTY_PENDING,
  downloadKind,
  downloadRecipe,
  fileBaseName,
  formatKesitLength,
  formatPosition,
  kesitRecipe,
  markPending,
  resolvePending,
  suggestedFileName,
  targetKey,
  topDownload,
  wholeVideoRecipe,
} from '@/domain/kesit';
import { loadProject } from '@/domain/migration';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { viewZoom } from '@/domain/transform';
import { validateProject } from '@/domain/validation';
import { accusativeSuffix } from '@/components/editor/KesitList';

const S = US_PER_SECOND;
const MIN = 60 * S;

const video: AssetV1 = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 120 * S,
  displayWidth: 1920,
  displayHeight: 1080,
  hasAudio: true,
};

function withKesitler(ranges: Array<[number, number]>, base = setVideoAsset(createEmptyProject(), video)): Project {
  let project = base;
  for (const [from, to] of ranges) {
    const result = addClip(project, { sourceInUs: from * S, sourceOutUs: to * S });
    if (!result.ok) throw new Error(result.reason);
    project = result.project;
  }
  return project;
}

const ids = (project: Project) => project.clips.map((clip) => clip.clipId);

describe('the top download button', () => {
  it('whole video with no kesit, the kesit itself with one, all joined with two or more', () => {
    const none = withKesitler([]);
    expect(topDownload(none)).toEqual({ kind: 'whole' });
    const one = withKesitler([[12, 100]]);
    expect(topDownload(one)).toEqual({ kind: 'single', clipId: 'c_001' });
    const three = withKesitler([[0, 10], [20, 30], [40, 50]]);
    expect(topDownload(three)).toEqual({ kind: 'merged', count: 3 });
    expect(downloadKind(none, { kind: 'all' })).toBe('whole');
    expect(downloadKind(one, { kind: 'all' })).toBe('kesit');
    expect(downloadKind(three, { kind: 'all' })).toBe('merged');
    expect(downloadKind(three, { kind: 'kesit', clipId: 'c_002' })).toBe('kesit');
    expect(targetKey({ kind: 'kesit', clipId: 'c_002' })).toBe('kesit:c_002');
    expect(targetKey({ kind: 'all' })).toBe('all');
  });
});

describe('the recipe each download encodes', () => {
  const project = withKesitler([[0, 10], [20, 25], [40, 50]]);

  it('one kesit: only that range; its plan is frame-accurate', () => {
    const recipe = kesitRecipe(project, 'c_002');
    expect(recipe?.clips).toEqual([project.clips[1]]);
    const plan = recipe ? compileRenderPlan(recipe, WEB_LOCAL_POLICY) : null;
    expect(plan?.ok && plan.plan.totalFrames).toBe(150);
    expect(plan?.ok && plan.plan.segments[0]).toMatchObject({ sourceInUs: 20 * S, sourceOutUs: 25 * S });
    // The stored recipe is untouched.
    expect(project.clips).toHaveLength(3);
    expect(kesitRecipe(project, 'nope')).toBeNull();
  });

  it('all kesitler: the recipe itself, joined in list order', () => {
    const moved = moveClipTo(project, 'c_003', 0);
    const recipe = downloadRecipe(moved, { kind: 'all' }, DEFAULT_KESIT_SETTINGS);
    expect(recipe).toBe(moved);
    const plan = recipe ? compileRenderPlan(recipe, WEB_LOCAL_POLICY) : null;
    if (!plan?.ok) throw new Error('plan');
    expect(plan.plan.segments.map((segment) => segment.sourceInUs / S)).toEqual([40, 0, 20]);
    expect(plan.plan.totalFrames).toBe(25 * 30);
  });

  it('no kesit: the whole video, with the settings the editor holds', () => {
    const empty = setFraming(withKesitler([]), { aspect: '9:16' });
    const settings = { fit: 'contain' as const, zoom: 1, sourceGainDb: -6, muted: false };
    const recipe = downloadRecipe(empty, { kind: 'all' }, settings);
    expect(recipe?.clips).toHaveLength(1);
    expect(recipe?.clips[0]).toMatchObject({ sourceInUs: 0, sourceOutUs: 120 * S, sourceGainDb: -6 });
    expect(recipe?.clips[0]?.view.fit).toBe('contain');
    expect(empty.clips).toHaveLength(0);
    expect(wholeVideoRecipe(createEmptyProject(), DEFAULT_KESIT_SETTINGS)).toBeNull();
  });

  it('ADR-021 gate per download: a kesit over 60 minutes is refused, the others still download', () => {
    const long = withKesitler([[0, 70 * 60], [0, 10]], setVideoAsset(createEmptyProject(), { ...video, durationUs: 80 * MIN }));
    expect(validateProject(long).ok).toBe(true);
    const first = kesitRecipe(long, 'c_001');
    const second = kesitRecipe(long, 'c_002');
    expect(first && compileRenderPlan(first, WEB_LOCAL_POLICY)).toEqual({
      ok: false,
      reason: 'output_duration_exceeds_policy',
    });
    expect(second && compileRenderPlan(second, WEB_LOCAL_POLICY).ok).toBe(true);
  });

  it('output-anchored lines: a kesit download is exactly its part of the joined video', () => {
    let joined: Project = {
      ...project,
      captionTracks: [
        {
          trackId: 't_001',
          origin: 'manual',
          timeBase: 'output',
          language: 'tr',
          style: { preset: 'box', position: 'bottom', size: 'medium' },
          cues: [],
        },
      ],
    };
    // Joined: kesit 1 is 0–10, kesit 2 is 10–15, kesit 3 is 15–25.
    for (const [from, to, text] of [[2, 4, 'birinci'], [9, 12, 'kesimde'], [16, 18, 'üçüncü']] as const) {
      const added = addCaptionCue(joined, { startUs: from * S, endUs: to * S, text });
      if (!added.ok) throw new Error(added.reason);
      joined = added.project;
    }
    const second = kesitRecipe(joined, 'c_002');
    expect(second?.captionTracks[0]?.cues.map((cue) => [cue.startUs / S, cue.endUs / S, cue.text])).toEqual([
      [0, 2, 'kesimde'],
    ]);
    const third = kesitRecipe(joined, 'c_003');
    expect(third?.captionTracks[0]?.cues.map((cue) => [cue.startUs / S, cue.endUs / S])).toEqual([[1, 3]]);
    // And the plan draws it on those frames only.
    const plan = second ? compileRenderPlan(second, WEB_LOCAL_POLICY) : null;
    expect(plan?.ok && plan.plan.captions?.cues.map((cue) => [cue.startFrame, cue.endFrame])).toEqual([[0, 60]]);
  });

  it('source-anchored lines follow each kesit with no change', () => {
    const added = addCaptionCue(project, { startUs: 21 * S, endUs: 23 * S, text: 'görüntüde' });
    if (!added.ok) throw new Error(added.reason);
    expect(added.project.captionTracks[0]?.timeBase).toBe('source');
    const recipe = kesitRecipe(added.project, 'c_002');
    const plan = recipe ? compileRenderPlan(recipe, WEB_LOCAL_POLICY) : null;
    // Video 21–23 s inside kesit 20–25 s: frames 30–90 of that download.
    expect(plan?.ok && plan.plan.captions?.cues.map((cue) => [cue.startFrame, cue.endFrame])).toEqual([[30, 90]]);
    const other = kesitRecipe(added.project, 'c_001');
    const none = other ? compileRenderPlan(other, WEB_LOCAL_POLICY) : null;
    expect(none?.ok && none.plan.captions).toBeNull();
  });
});

describe('lines on the video clock (the preview and the strip)', () => {
  it('source lines are where they are; output lines are placed through each kesit', () => {
    const project = withKesitler([[10, 20], [10, 20]]);
    const withOutput: Project = {
      ...project,
      captionTracks: [
        {
          trackId: 't_001',
          origin: 'manual',
          timeBase: 'output',
          language: 'tr',
          style: { preset: 'box', position: 'bottom', size: 'medium' },
          cues: [
            { cueId: 'q_001', startUs: 1 * S, endUs: 2 * S, text: 'ilk' },
            { cueId: 'q_002', startUs: 11 * S, endUs: 12 * S, text: 'ikinci' },
          ],
        },
      ],
    };
    expect(videoCues(withOutput).map((cue) => [cue.cueId, cue.startUs / S])).toEqual([
      ['q_001', 11],
      ['q_002', 11],
    ]);
    // The same picture in two kesitler: the one being played or selected decides.
    expect(captionAtVideoTime(withOutput, 11.5 * S, null)?.text).toBe('ilk');
    expect(captionAtVideoTime(withOutput, 11.5 * S, 'c_002')?.text).toBe('ikinci');
    expect(captionAtVideoTime(withOutput, 30 * S, null)).toBeUndefined();

    const withSource = addCaptionCue(project, { startUs: 50 * S, endUs: 52 * S, text: 'dışarıda' });
    if (!withSource.ok) throw new Error(withSource.reason);
    // A source line shows on the video even where no kesit is.
    expect(captionAtVideoTime(withSource.project, 51 * S, null)?.text).toBe('dışarıda');
  });
});

describe('kesit commands', () => {
  it('a new kesit copies the first one’s framing and sound; the first takes the editor’s', () => {
    const empty = setFraming(withKesitler([]), { aspect: '9:16' });
    const first = addClip(empty, { sourceInUs: 0, sourceOutUs: 5 * S }, WEB_LOCAL_POLICY, {
      fit: 'cover',
      zoom: 1.5,
      sourceGainDb: -9,
      muted: true,
    });
    if (!first.ok) throw new Error(first.reason);
    const clip = first.project.clips[0];
    expect(clip).toMatchObject({ sourceGainDb: -9, muted: true });
    expect(clip && viewZoom(clip.view, 1920, 1080, '9:16')).toBeCloseTo(1.5, 5);
    const second = addClip(first.project, { sourceInUs: 10 * S, sourceOutUs: 15 * S });
    if (!second.ok) throw new Error(second.reason);
    expect(second.project.clips[1]).toMatchObject({ sourceGainDb: -9, muted: true, view: clip?.view });
  });

  it('video sound applies to every kesit, one undo step, no-op when unchanged', () => {
    const project = withKesitler([[0, 5], [10, 15]]);
    const quieter = setVideoGain(project, -12.4);
    expect(quieter.clips.map((clip) => clip.sourceGainDb)).toEqual([-12, -12]);
    expect(quieter.revision).toBe(project.revision + 1);
    expect(setVideoGain(quieter, -12)).toBe(quieter);
    expect(setVideoGain(project, 20).clips[0]?.sourceGainDb).toBe(0);
    const muted = setVideoMuted(project, true);
    expect(muted.clips.every((clip) => clip.muted)).toBe(true);
    expect(setVideoMuted(muted, true)).toBe(muted);
  });

  it('reorders by drag target or one step; ends clamp; one bump each', () => {
    const project = withKesitler([[0, 1], [2, 3], [4, 5], [6, 7]]);
    const moved = moveClipTo(project, 'c_004', 1);
    expect(ids(moved)).toEqual(['c_001', 'c_004', 'c_002', 'c_003']);
    expect(moved.revision).toBe(project.revision + 1);
    expect(ids(moveClipTo(project, 'c_001', 99))).toEqual(['c_002', 'c_003', 'c_004', 'c_001']);
    expect(moveClipTo(project, 'c_002', 1)).toBe(project);
    expect(moveClipTo(project, 'nope', 0)).toBe(project);
    expect(ids(moveClip(project, 'c_002', -1))).toEqual(['c_002', 'c_001', 'c_003', 'c_004']);
    expect(moveClip(project, 'c_001', -1)).toBe(project);
    expect(validateProject(moved).ok).toBe(true);
  });

  it('delete removes only that kesit; its range stays in the video', () => {
    const project = withKesitler([[0, 5], [10, 15]]);
    const after = removeClip(project, 'c_001');
    expect(ids(after)).toEqual(['c_002']);
    expect(after.assets).toEqual(project.assets);
  });

  it('silences on the whole video: the pieces that remain become the kesitler, one step', () => {
    const empty = withKesitler([]);
    const whole = withWholeKesit(empty);
    if (!whole.ok) throw new Error(whole.reason);
    expect(whole.project.clips).toEqual([expect.objectContaining({ sourceInUs: 0, sourceOutUs: 120 * S })]);
    const cut = applySilenceCuts(whole.project, [
      { clipId: 'c_001', startUs: 10 * S, endUs: 12 * S },
      { clipId: 'c_001', startUs: 50 * S, endUs: 53 * S },
    ]);
    if (!cut.ok) throw new Error(cut.reason);
    expect(cut.project.clips.map((clip) => [clip.sourceInUs / S, clip.sourceOutUs / S])).toEqual([
      [0, 10],
      [12, 50],
      [53, 120],
    ]);
    expect(cut.project.revision).toBeGreaterThan(empty.revision);
  });

  it('silences within the 20-kesit limit (doc 15: 20 klip → 20 kesit)', () => {
    const project = withKesitler(Array.from({ length: 19 }, (_, i) => [i * 5, i * 5 + 4] as [number, number]));
    const refused = applySilenceCuts(project, [
      { clipId: 'c_001', startUs: 1 * S, endUs: 1.5 * S },
      { clipId: 'c_001', startUs: 2 * S, endUs: 2.5 * S },
    ]);
    expect(refused).toMatchObject({ ok: false, reason: 'clip_limit_exceeded', clipsAfter: 21 });
  });
});

describe('old projects open as kesitler', () => {
  it('a saved project with the old automatic whole piece is one kesit over the whole video', () => {
    const saved = withKesitler([[0, 120]]);
    const loaded = loadProject(JSON.parse(JSON.stringify(saved)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(topDownload(loaded.project)).toEqual({ kind: 'single', clipId: 'c_001' });
    expect(loaded.project.clips[0]).toMatchObject({ sourceInUs: 0, sourceOutUs: 120 * S });
  });
});

describe('names and labels', () => {
  it('suggests a file name from the video and the kesit', () => {
    expect(suggestedFileName('tatil.mp4', { kind: 'kesit', sourceInUs: 12 * S, sourceOutUs: 100 * S })).toBe(
      'tatil_00-12-01-40.mp4',
    );
    expect(suggestedFileName('Yaz Tatili 2026.MOV', { kind: 'merged', count: 3 })).toBe('Yaz-Tatili-2026_3-kesit.mp4');
    expect(suggestedFileName('tatil.mp4', { kind: 'whole' })).toBe('tatil_tamami.mp4');
    expect(
      suggestedFileName('uzun.mp4', { kind: 'kesit', sourceInUs: 3600 * S + 5 * S, sourceOutUs: 3725.9 * S }),
    ).toBe('uzun_1-00-05-1-02-05.mp4');
    expect(fileBaseName('../../etc/passwd')).toBe('etcpasswd');
    expect(fileBaseName('...mp4')).toBe('video');
    expect(fileBaseName('çalışma ğüşiöç.webm')).toBe('çalışma-ğüşiöç');
  });

  it('positions round down, lengths never read 0:00', () => {
    expect(formatPosition(12.9 * S)).toBe('00:12');
    expect(formatPosition(100 * S)).toBe('01:40');
    expect(formatPosition(3723 * S)).toBe('1:02:03');
    expect(formatKesitLength(88 * S)).toBe('1:28');
    expect(formatKesitLength(0.2 * S)).toBe('0:01');
    expect(formatKesitLength(3723.4 * S)).toBe('1:02:03');
  });

  it('Turkish accusative after the kesit number, as read aloud', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20].map(accusativeSuffix)).toEqual([
      "'i", "'yi", "'ü", "'ü", "'i", "'yı", "'yi", "'i", "'u", "'u", "'i", "'yi", "'yi",
    ]);
  });
});

describe('marking Başlangıç (I) and Bitiş (O)', () => {
  it('unmarked edges are the start and the end of the video', () => {
    expect(resolvePending(EMPTY_PENDING, 90 * S)).toEqual({ sourceInUs: 0, sourceOutUs: 90 * S });
    expect(resolvePending({ inUs: 12 * S, outUs: null }, 90 * S)).toEqual({ sourceInUs: 12 * S, sourceOutUs: 90 * S });
  });

  it('the latest mark wins: a start after the end drops the end, and back', () => {
    let pending = markPending(EMPTY_PENDING, 'in', 10 * S);
    pending = markPending(pending, 'out', 20 * S);
    expect(pending).toEqual({ inUs: 10 * S, outUs: 20 * S });
    expect(markPending(pending, 'in', 25 * S)).toEqual({ inUs: 25 * S, outUs: null });
    expect(markPending(pending, 'out', 5 * S)).toEqual({ inUs: null, outUs: 5 * S });
    expect(markPending(pending, 'in', 12.4 * S + 0.4)).toEqual({ inUs: 12_400_000, outUs: 20 * S });
  });
});
