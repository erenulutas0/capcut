import { describe, expect, it } from 'vitest';

import { analysisKey, pictureRects } from '@/adapters/export/enhanceAnalysis';
import { addClip, createEmptyProject, setEnhance, setFraming, setVideoAsset } from '@/application/commands';
import { commit, initHistory, undo } from '@/application/history';
import {
  DEFAULT_ENHANCE_STRENGTH,
  ENHANCE_PREVIEW_SHARES,
  enhancePreviewFrame,
  enhanceRecipe,
} from '@/application/taskRecipes';
import { EDL_SCHEMA_VERSION, ENHANCE_STRENGTHS_V4, type AssetV1, type Project } from '@/domain/edl';
import { ENHANCE_STRENGTHS } from '@/domain/enhance';
import { fastCutEligibility, type FastCutSourceFacts } from '@/domain/fastPath';
import { downloadRecipe, kesitRecipe, wholeVideoRecipe, DEFAULT_KESIT_SETTINGS } from '@/domain/kesit';
import { loadProject, migrateProject } from '@/domain/migration';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { createRecord, parseRecord } from '@/domain/projectRecord';
import { compileRenderPlan, segmentDrawRect, type RenderPlan } from '@/domain/renderPlan';
import { planForTargetSize } from '@/domain/targetSize';
import { US_PER_SECOND } from '@/domain/time';
import { issueCodes, validateProject } from '@/domain/validation';

const S = US_PER_SECOND;

function video(patch: Partial<AssetV1> = {}): AssetV1 {
  return { assetId: 'a_video_001', kind: 'video', durationUs: 20 * S, displayWidth: 1920, displayHeight: 1080, hasAudio: true, ...patch };
}

function opened(asset = video()): Project {
  return setVideoAsset(createEmptyProject(), asset);
}

function withKesit(project: Project, fromS = 2, toS = 6): Project {
  const result = addClip(project, { sourceInUs: fromS * S, sourceOutUs: toS * S });
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

function plan(project: Project): RenderPlan {
  const recipe = downloadRecipe(project, { kind: 'all' }, DEFAULT_KESIT_SETTINGS);
  if (!recipe) throw new Error('no recipe');
  const compiled = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
  if (!compiled.ok) throw new Error(compiled.reason);
  return compiled.plan;
}

/* ------------------------------------------------------------------ recipe */

describe('the enhancement setting in the recipe (EDL v4)', () => {
  it('is off by default: a new recipe has no such field', () => {
    const project = opened();
    expect(EDL_SCHEMA_VERSION).toBe(4);
    expect('enhance' in project).toBe(false);
    expect(validateProject(withKesit(project)).ok).toBe(true);
  });

  it('setEnhance switches it on at a strength and off again; each change is one revision', () => {
    const project = withKesit(opened());
    const on = setEnhance(project, 'auto');
    expect(on.enhance).toEqual({ strength: 'auto' });
    expect(on.revision).toBe(project.revision + 1);
    expect(validateProject(on).ok).toBe(true);

    // The same value again changes nothing (no new undo step, no new revision).
    expect(setEnhance(on, 'auto')).toBe(on);
    expect(setEnhance(project, null)).toBe(project);

    const strong = setEnhance(on, 'strong');
    expect(strong.enhance).toEqual({ strength: 'strong' });
    expect(strong.revision).toBe(on.revision + 1);

    // Off removes the field: the recipe is what it was before the setting existed.
    const off = setEnhance(strong, null);
    expect('enhance' in off).toBe(false);
    expect(off.revision).toBe(strong.revision + 1);
    expect({ ...off, revision: project.revision }).toEqual(project);
    expect(validateProject(off).ok).toBe(true);
  });

  it('is one undo step', () => {
    const project = withKesit(opened());
    const history = commit(initHistory(project), setEnhance(project, 'light'));
    expect(history.present.enhance).toEqual({ strength: 'light' });
    expect(undo(history).present).toBe(project);
  });

  it('accepts the three strengths and nothing else', () => {
    const project = withKesit(opened());
    expect(ENHANCE_STRENGTHS_V4).toEqual(ENHANCE_STRENGTHS);
    for (const strength of ENHANCE_STRENGTHS_V4) {
      expect(validateProject({ ...project, enhance: { strength } }).ok, strength).toBe(true);
    }
    expect(issueCodes(validateProject({ ...project, enhance: { strength: 'max' } }))).toContain('enhance_invalid');
    expect(issueCodes(validateProject({ ...project, enhance: {} }))).toContain('enhance_invalid');
    expect(issueCodes(validateProject({ ...project, enhance: { strength: 'auto', gain: 2 } }))).toContain('unknown_field');
    expect(issueCodes(validateProject({ ...project, enhance: 'auto' }))).toContain('not_an_object');
    expect(issueCodes(validateProject({ ...project, enhance: null }))).toContain('not_an_object');
  });

  it('every download recipe carries the setting: all kesitler, one kesit, the whole video', () => {
    const project = setEnhance(withKesit(withKesit(opened(), 1, 3), 8, 12), 'strong');
    const first = project.clips[0];
    if (!first) throw new Error('no clip');
    expect(downloadRecipe(project, { kind: 'all' }, DEFAULT_KESIT_SETTINGS)?.enhance).toEqual({ strength: 'strong' });
    expect(kesitRecipe(project, first.clipId)?.enhance).toEqual({ strength: 'strong' });
    expect(wholeVideoRecipe(setEnhance(opened(), 'light'), DEFAULT_KESIT_SETTINGS)?.enhance).toEqual({ strength: 'light' });
  });

  it('survives the stored project record and a backup file, to the byte', () => {
    const project = setEnhance(withKesit(opened()), 'auto');
    const record = createRecord(project.projectId, 'Deneme', project, []);
    // Through JSON, as IndexedDB's structured clone and the backup file carry it.
    const parsed = parseRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.record.edl.enhance).toEqual({ strength: 'auto' });
      expect(parsed.record.edl).toEqual(project);
    }
    // A record written before the setting existed (EDL v3) opens with it off.
    const old = createRecord(project.projectId, 'Eski', { ...withKesit(opened()), schemaVersion: 3 } as unknown as Project, []);
    const reopened = parseRecord(JSON.parse(JSON.stringify(old)));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(reopened.record.edl.schemaVersion).toBe(4);
      expect('enhance' in reopened.record.edl).toBe(false);
    }
  });
});

describe('older recipes (v1, v2, v3) open unchanged, with enhancement off', () => {
  const v4 = withKesit(opened());

  it('v3 → v4 is the number alone', () => {
    const v3 = { ...v4, schemaVersion: 3 };
    expect(validateProject(v3).ok).toBe(false);
    const loaded = loadProject(v3);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.project.schemaVersion).toBe(4);
    expect('enhance' in loaded.project).toBe(false);
    expect({ ...loaded.project, schemaVersion: 3 }).toEqual(v3);
  });

  it('v2 and v1 still arrive at the current schema', () => {
    const v2 = loadProject({ ...v4, schemaVersion: 2 });
    expect(v2.ok && v2.project.schemaVersion).toBe(4);
    const { captionTracks: _dropped, ...withoutCaptions } = v4;
    const v1 = loadProject({ ...withoutCaptions, schemaVersion: 1 });
    expect(v1.ok && v1.project.schemaVersion).toBe(4);
    if (v1.ok) expect(v1.project.captionTracks).toEqual([]);
  });

  it('an older recipe that already carries the v4 field was written by no build: left for the validator to refuse', () => {
    for (const schemaVersion of [1, 2, 3]) {
      const odd = { ...v4, schemaVersion, enhance: { strength: 'auto' } };
      expect(migrateProject(odd)).toBe(odd);
      expect(issueCodes(loadProject(odd)), `v${schemaVersion}`).toContain('schema_version_unsupported');
    }
  });

  it('a later schema is refused, not guessed at', () => {
    expect(issueCodes(loadProject({ ...v4, schemaVersion: 5 }))).toContain('schema_version_unsupported');
  });
});

/* -------------------------------------------------------------- render plan */

describe('the render plan', () => {
  it('carries the request, and nothing when it is off', () => {
    const project = withKesit(opened());
    expect(plan(project).enhance).toBeNull();
    expect(plan(setEnhance(project, 'auto')).enhance).toEqual({ strength: 'auto' });
  });

  it('the fingerprint of a plan without enhancement is what it always was; with it, it differs per strength', () => {
    const project = withKesit(opened());
    const off = plan(project).fingerprint;
    // The value this recipe had before the setting existed (computed by the previous build).
    expect(plan(setEnhance(setEnhance(project, 'auto'), null)).fingerprint).toBe(off);
    const prints = ENHANCE_STRENGTHS_V4.map((strength) => plan(setEnhance(project, strength)).fingerprint);
    expect(new Set([off, ...prints]).size).toBe(4);
    // Everything else about the plan is the same: frames, size, bit rates, segments.
    const { fingerprint: _a, enhance: _b, ...plain } = plan(project);
    const { fingerprint: _c, enhance: _d, ...enhanced } = plan(setEnhance(project, 'strong'));
    expect(enhanced).toEqual(plain);
  });

  it('a target-size attempt keeps the request', () => {
    const base = plan(setEnhance(withKesit(opened()), 'light'));
    const attempt = planForTargetSize(base, {
      ok: true,
      targetBytes: 16_000_000,
      shortEdge: 720,
      width: 1280,
      height: 720,
      videoBitrate: 900_000,
      audioBitrate: 96_000,
      encoderKind: 'hardware',
      mode: 'reduced',
      plannedBytes: 15_000_000,
      attempt: 1,
    });
    expect(attempt.enhance).toEqual({ strength: 'light' });
  });
});

describe('fast cut: an enhanced video is never a copy', () => {
  const source: FastCutSourceFacts = {
    codec: 'avc',
    isobmff: true,
    hdr: false,
    sps: { chromaFormatIdc: 1, bitDepthLuma: 8, bitDepthChroma: 8, frameMbsOnly: true },
    lengthSize: 4,
    displayWidth: 1920,
    displayHeight: 1080,
    squarePixels: true,
    fullRange: false,
    wideGamut: false,
    needsReorderFix: false,
  };

  it('the same plan that would be copied is fully encoded once enhancement is on, and the reason says so', () => {
    const project = withKesit(opened());
    const plain = plan(setFraming(project, { aspect: '16:9' }));
    expect(fastCutEligibility(plain, source, 'auto')).toEqual({ ok: true });
    for (const strength of ENHANCE_STRENGTHS_V4) {
      const enhanced = plan(setEnhance(setFraming(project, { aspect: '16:9' }), strength));
      expect(fastCutEligibility(enhanced, source, 'auto')).toEqual({ ok: false, reason: 'enhance' });
    }
  });

  it('is named before the other reasons, except an explicit full encode', () => {
    const enhanced = { ...plan(setEnhance(withKesit(opened()), 'auto')), captions: { language: 'tr', style: {} as never, cues: [] } };
    expect(fastCutEligibility(enhanced, { ...source, hdr: true, codec: 'hevc' }, 'auto')).toEqual({ ok: false, reason: 'enhance' });
    expect(fastCutEligibility(enhanced, source, 'encode')).toEqual({ ok: false, reason: 'requested_encode' });
  });
});

/* ------------------------------------------------------------------ wizard */

describe('"İyileştir" wizard recipe', () => {
  it('opens the video at its own size with "Otomatik" on', () => {
    expect(DEFAULT_ENHANCE_STRENGTH).toBe('auto');
    const small = enhanceRecipe(opened(video({ displayWidth: 1280, displayHeight: 720 })));
    expect(small.enhance).toEqual({ strength: 'auto' });
    expect(small.export.shortEdge).toBe(720);
    const large = enhanceRecipe(opened(video({ displayWidth: 3840, displayHeight: 2160 })), 'strong');
    expect(large.enhance).toEqual({ strength: 'strong' });
    expect(large.export.shortEdge).toBe(1080);
    // What "İndir" would compile: the whole video, enhanced.
    expect(plan(small).enhance).toEqual({ strength: 'auto' });
    expect(plan(small).totalFrames).toBe(600);
  });

  it('the preview frames are spread over the video and stay inside it', () => {
    const total = 600;
    const frames = ENHANCE_PREVIEW_SHARES.map((_, shot) => enhancePreviewFrame(total, shot));
    expect(new Set(frames).size).toBe(ENHANCE_PREVIEW_SHARES.length);
    for (const frame of frames) {
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(total);
    }
    // "Başka bir kare" comes round again.
    expect(enhancePreviewFrame(total, ENHANCE_PREVIEW_SHARES.length)).toBe(frames[0]);
    expect(enhancePreviewFrame(1, 0)).toBe(0);
    expect(enhancePreviewFrame(1, 3)).toBe(0);
  });
});

/* ---------------------------------------------------------------- geometry */

describe('where the picture is in the frame', () => {
  it('"Doldur" fills the frame; "Sığdır" is centred and the rest is bars', () => {
    const size = { width: 1080, height: 1920 };
    const crop = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(segmentDrawRect({ crop, fit: 'cover' }, size)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    const contained = segmentDrawRect({ crop, fit: 'contain' }, size);
    expect(contained.width).toBe(1080);
    expect(contained.height).toBeCloseTo(607.5, 6);
    expect(contained.y).toBeCloseTo((1920 - 607.5) / 2, 6);
  });

  it('enhances every pixel the picture touches and measures only the ones it covers fully', () => {
    const size = { width: 1080, height: 1920 };
    const crop = { x: 0, y: 0, width: 1920, height: 1080 };
    const { outer, inner } = pictureRects({ crop, fit: 'contain' }, size);
    // 607.5 rows starting at 656.25: rows 656..1263 are touched, 657..1262 are fully covered.
    expect(outer).toEqual({ x: 0, y: 656, width: 1080, height: 608 });
    expect(inner).toEqual({ x: 0, y: 657, width: 1080, height: 606 });
    const whole = pictureRects({ crop, fit: 'cover' }, size);
    expect(whole.outer).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(whole.inner).toEqual(whole.outer);
  });
});

describe('analysisKey: what a set of measurements belongs to', () => {
  const file = { name: 'video.mp4', size: 1234, lastModified: 99 };

  it('is the same for every strength of the same recipe (one look at the video serves all three)', () => {
    const project = withKesit(opened());
    const keys = ENHANCE_STRENGTHS_V4.map((strength) => analysisKey(plan(setEnhance(project, strength)), file));
    expect(new Set(keys).size).toBe(1);
  });

  it('changes with the file, the frame size and the moments', () => {
    const project = setEnhance(withKesit(opened()), 'auto');
    const key = analysisKey(plan(project), file);
    expect(analysisKey(plan(project), { ...file, size: 1235 })).not.toBe(key);
    expect(analysisKey(plan(project), { ...file, lastModified: 100 })).not.toBe(key);
    expect(analysisKey(plan(withKesit(project, 10, 12)), file)).not.toBe(key);
    expect(analysisKey(plan(setFraming(project, { aspect: '9:16' })), file)).not.toBe(key);
    expect(analysisKey(plan({ ...project, export: { ...project.export, shortEdge: 720 } }), file)).not.toBe(key);
  });
});
