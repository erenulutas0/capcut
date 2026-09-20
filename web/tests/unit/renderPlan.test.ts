import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AssetV1, ProjectV1 } from '@/domain/edl';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import {
  compileRenderPlan,
  frameAtUs,
  frameToUs,
  sourceTimeForFrame,
} from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { createEmptyProject, addClip, setFraming, setMusicAsset, setVideoAsset } from '@/application/commands';

const video: AssetV1 = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 24 * US_PER_SECOND,
  displayWidth: 1920,
  displayHeight: 1080,
  hasAudio: true,
};

const music: AssetV1 = {
  assetId: 'a_music_001',
  kind: 'audio',
  durationUs: 30 * US_PER_SECOND,
};

function projectWith(ranges: Array<[number, number]>): ProjectV1 {
  let project = setVideoAsset(createEmptyProject(), video);
  for (const [from, to] of ranges) {
    const result = addClip(project, {
      sourceInUs: from * US_PER_SECOND,
      sourceOutUs: to * US_PER_SECOND,
    });
    if (!result.ok) throw new Error(result.reason);
    project = result.project;
  }
  return project;
}

function compile(project: ProjectV1) {
  const result = compileRenderPlan(project, WEB_LOCAL_POLICY);
  if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
  return result.plan;
}

describe('frame grid', () => {
  it('rounds output timestamps onto the fps grid', () => {
    expect(frameAtUs(0, 30, 1)).toBe(0);
    expect(frameAtUs(US_PER_SECOND, 30, 1)).toBe(30);
    expect(frameAtUs(4 * US_PER_SECOND, 30, 1)).toBe(120);
    // 33_333 µs is one frame at 30 fps.
    expect(frameAtUs(33_333, 30, 1)).toBe(1);
    expect(frameToUs(30, 30, 1)).toBe(US_PER_SECOND);
  });
});

describe('render plan', () => {
  it('turns the doc 10 example into a 10 second, 300 frame plan', () => {
    const plan = compile(projectWith([[0, 4], [8, 14]]));
    expect(plan.totalFrames).toBe(300);
    expect(plan.expectedDurationUs).toBe(10 * US_PER_SECOND);
    expect(plan.requestedDurationUs).toBe(10 * US_PER_SECOND);
    expect(plan.segments.map((s) => [s.startFrame, s.endFrame])).toEqual([
      [0, 120],
      [120, 300],
    ]);
  });

  it('leaves no gap or overlap between segment frame ranges', () => {
    const plan = compile(projectWith([[0, 1.5], [3, 4.7], [10, 12.25]]));
    let cursor = 0;
    for (const segment of plan.segments) {
      expect(segment.startFrame).toBe(cursor);
      cursor = segment.endFrame;
    }
    expect(cursor).toBe(plan.totalFrames);
  });

  it('maps every output frame back to the right source time', () => {
    const plan = compile(projectWith([[0, 4], [8, 14]]));
    const second = plan.segments[1]!;

    // Output frame 120 is the first frame of the second moment: source 8 s.
    expect(sourceTimeForFrame(second, 120, 30, 1)).toBeCloseTo(8, 6);
    // Output 5 s = frame 150 -> source 9 s (same answer as the preview).
    expect(sourceTimeForFrame(second, 150, 30, 1)).toBeCloseTo(9, 6);
  });

  it('derives output pixels and crop from the canvas aspect', () => {
    let project = projectWith([[0, 4]]);
    project = setFraming(project, { aspect: '9:16', fit: 'cover' });
    const plan = compile(project);

    expect({ width: plan.width, height: plan.height }).toEqual({ width: 1080, height: 1920 });
    const crop = plan.segments[0]!.crop;
    expect(crop.height).toBe(1080);
    expect(crop.width).toBe(608); // 1080 * 9/16 rounded to an even number
    expect(crop.x + crop.width).toBeLessThanOrEqual(1920);
  });

  it('resolves gains to linear values and mutes to zero', () => {
    const plan = compile(projectWith([[0, 4]]));
    expect(plan.segments[0]!.gain).toBeCloseTo(1, 6);
    expect(plan.audio.wantsSourceAudio).toBe(true);

    let project = projectWith([[0, 4]]);
    project = { ...project, clips: project.clips.map((clip) => ({ ...clip, muted: true })) };
    const mutedPlan = compile(project);
    expect(mutedPlan.segments[0]!.gain).toBe(0);
    // Every moment muted means the user does not want source audio at all.
    expect(mutedPlan.audio.wantsSourceAudio).toBe(false);
  });

  it('applies the doc 09 headroom formula when music plays over the source', () => {
    let project = projectWith([[0, 4]]);
    project = setMusicAsset(project, music);
    const plan = compile(project);

    const musicGain = plan.audio.music!.gain;
    const expected = Math.pow(10, -1 / 20) / Math.max(1, 1 + musicGain);
    expect(plan.audio.safetyGain).toBeCloseTo(expected, 9);
    expect(plan.audio.safetyGain).toBeLessThan(1);
  });

  it('is deterministic: the same recipe gives the same fingerprint', () => {
    const a = compile(projectWith([[0, 4], [8, 14]]));
    const b = compile(projectWith([[0, 4], [8, 14]]));
    expect(a.fingerprint).toBe(b.fingerprint);

    const different = compile(projectWith([[0, 4], [8, 13]]));
    expect(different.fingerprint).not.toBe(a.fingerprint);
  });

  it('asks for source audio even when the probe could not tell us about it', () => {
    // `hasAudio` is absent on the asset: the plan must still want source audio
    // and let the demuxer decide, instead of silently exporting a silent video.
    let project = setVideoAsset(createEmptyProject(), {
      assetId: 'a_video_001',
      kind: 'video',
      durationUs: 24 * US_PER_SECOND,
      displayWidth: 1280,
      displayHeight: 720,
    });
    const added = addClip(project, { sourceInUs: 0, sourceOutUs: 3 * US_PER_SECOND });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    project = added.project;
    expect(compile(project).audio.wantsSourceAudio).toBe(true);
  });

  it('ignores values that do not change the produced frames', () => {
    const base = projectWith([[0, 4]]);
    const renamed: ProjectV1 = { ...base, projectId: 'p_other', revision: base.revision + 40 };
    expect(compile(renamed).fingerprint).toBe(compile(base).fingerprint);
  });

  it('refuses a recipe it cannot render', () => {
    expect(compileRenderPlan(createEmptyProject(), WEB_LOCAL_POLICY)).toMatchObject({
      reason: 'no_clips',
    });

    const noDims = setVideoAsset(createEmptyProject(), {
      assetId: 'a_video_001',
      kind: 'video',
      durationUs: 10 * US_PER_SECOND,
    });
    const withClip = addClip(noDims, { sourceInUs: 0, sourceOutUs: 2 * US_PER_SECOND });
    expect(withClip.ok).toBe(true);
    if (withClip.ok) {
      expect(compileRenderPlan(withClip.project, WEB_LOCAL_POLICY)).toMatchObject({
        reason: 'missing_source_dimensions',
      });
    }
  });

  it('compiles the shared doc10 fixture without touching the EDL', () => {
    const fixture: ProjectV1 = JSON.parse(
      readFileSync(join(process.cwd(), 'fixtures', 'edl', 'valid', 'doc10-example.json'), 'utf8'),
    );
    const before = JSON.stringify(fixture);
    const plan = compile(fixture);
    expect(plan.expectedDurationUs).toBe(10 * US_PER_SECOND);
    expect(JSON.stringify(fixture)).toBe(before);
  });
});
