import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SegmentAudioWriter, type AudioContextSources } from '@/adapters/export/segmentAudio';
import type { AudioStreamReader } from '@/adapters/export/audioStream';
import { addClip, createEmptyProject, setEnhance, setMusicAsset, setSoundFix, setVideoAsset } from '@/application/commands';
import { commit, initHistory, undo } from '@/application/history';
import { PcmRingBuffer } from '@/domain/audioMix';
import {
  EDL_SCHEMA_VERSION,
  PROJECT_TOP_LEVEL_KEYS,
  SOUND_FIX_TARGETS_V6,
  SOUND_FIX_TARGET_LUFS_V6,
  type AssetV1,
  type Project,
} from '@/domain/edl';
import { fastCutEligibility, type FastCutSourceFacts } from '@/domain/fastPath';
import { DEFAULT_KESIT_SETTINGS, downloadRecipe } from '@/domain/kesit';
import { loadProject, loadStoredProject, migrateProject } from '@/domain/migration';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { createRecord } from '@/domain/projectRecord';
import { parseRecord } from '@/domain/recordParse';
import { compileRenderPlan, type RenderPlan } from '@/domain/renderPlan';
import { SOUND_FIX_VERSION, TARGET_LUFS } from '@/domain/soundFix';
import { SOUND_FIX_VERSION as PLAN_SOUND_FIX_VERSION } from '@/domain/soundFixVersion';
import { US_PER_SECOND } from '@/domain/time';
import { issueCodes, validateProject, validateStoredProject } from '@/domain/validation';

/**
 * "Sesi düzelt" in the editor (ADR-050, EDL v6): one optional setting in the
 * recipe, `soundFix: { targetLufs: -16 }`, read by the render plan and by the
 * export, which measures the download's own mix (`SegmentAudioWriter`'s
 * `measure`) the way the card measures the video's sound (ADR-049).
 */

const S = US_PER_SECOND;
const FIXTURES = join(process.cwd(), 'fixtures', 'edl');
const fixture = (file: string) => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as Record<string, unknown>;

function video(patch: Partial<AssetV1> = {}): AssetV1 {
  return { assetId: 'a_video_001', kind: 'video', durationUs: 20 * S, displayWidth: 1280, displayHeight: 720, hasAudio: true, ...patch };
}

function withKesit(project: Project, fromS = 2, toS = 6): Project {
  const result = addClip(project, { sourceInUs: fromS * S, sourceOutUs: toS * S });
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

const opened = () => withKesit(setVideoAsset(createEmptyProject(), video()));

function plan(project: Project): RenderPlan {
  const recipe = downloadRecipe(project, { kind: 'all' }, DEFAULT_KESIT_SETTINGS);
  if (!recipe) throw new Error('no recipe');
  const compiled = compileRenderPlan(recipe, WEB_LOCAL_POLICY);
  if (!compiled.ok) throw new Error(compiled.reason);
  return compiled.plan;
}

describe('the setting in the recipe (EDL v6)', () => {
  it('is v6, off by default, and the one target is the chain’s own', () => {
    expect(EDL_SCHEMA_VERSION).toBe(6);
    expect(PROJECT_TOP_LEVEL_KEYS).toContain('soundFix');
    expect('soundFix' in opened()).toBe(false);
    // The recipe's target and the chain's target are one number; the plan's chain number is the chain's.
    expect(SOUND_FIX_TARGET_LUFS_V6).toBe(TARGET_LUFS);
    expect(SOUND_FIX_TARGETS_V6).toEqual([TARGET_LUFS]);
    expect(PLAN_SOUND_FIX_VERSION).toBe(SOUND_FIX_VERSION);
  });

  it('setSoundFix turns it on and off; each change is one revision, and off is the recipe before the setting', () => {
    const project = opened();
    const on = setSoundFix(project, true);
    expect(on.soundFix).toEqual({ targetLufs: -16 });
    expect(on.revision).toBe(project.revision + 1);
    expect(validateProject(on).ok).toBe(true);
    // The same value again changes nothing (no undo step, no revision).
    expect(setSoundFix(on, true)).toBe(on);
    expect(setSoundFix(project, false)).toBe(project);
    const off = setSoundFix(on, false);
    expect('soundFix' in off).toBe(false);
    expect(off.revision).toBe(on.revision + 1);
    expect({ ...off, revision: project.revision }).toEqual(project);
  });

  it('is one undo step', () => {
    const project = opened();
    const history = commit(initHistory(project), setSoundFix(project, true));
    expect(history.present.soundFix).toEqual({ targetLufs: -16 });
    expect(undo(history).present).toEqual(project);
  });

  it('accepts only { targetLufs: -16 }', () => {
    const on = setSoundFix(opened(), true);
    const as = (soundFix: unknown) => issueCodes(validateProject({ ...on, soundFix }));
    expect(as({ targetLufs: -16 })).toEqual([]);
    expect(as({ targetLufs: -23 })).toEqual(['sound_fix_invalid']);
    expect(as({ targetLufs: -14 })).toEqual(['sound_fix_invalid']);
    expect(as({ targetLufs: '-16' })).toEqual(['sound_fix_invalid']);
    expect(as({ targetLufs: Number.NaN })).toEqual(['sound_fix_invalid']);
    expect(as({})).toEqual(['sound_fix_invalid']);
    expect(as({ targetLufs: -16, truePeakDbtp: -1 })).toEqual(['unknown_field']);
    expect(as(true)).toEqual(['not_an_object']);
    expect(as(null)).toEqual(['not_an_object']);
    expect(as([-16])).toEqual(['not_an_object']);
  });

  it('lives beside every other setting: music, captions, "İyileştir", a project with no kesit yet', () => {
    const fixtureOn = fixture('valid/sound-fix-with-music-and-enhance.json');
    expect(validateProject(fixtureOn).ok).toBe(true);
    const bare = setSoundFix(setVideoAsset(createEmptyProject(), video()), true);
    expect(bare.clips).toEqual([]);
    expect(validateStoredProject(bare).ok).toBe(true);
    expect(validateProject(setEnhance(setSoundFix(opened(), true), 'auto')).ok).toBe(true);
  });
});

describe('old recipes: v5 opens as v6, identical apart from the number, with the setting off', () => {
  const legacy = readdirSync(join(FIXTURES, 'legacy-v5')).filter((name) => name !== 'v5-with-sound-fix.json');

  it.each(legacy)('legacy-v5/%s', (name) => {
    const raw = fixture(`legacy-v5/${name}`);
    expect(raw.schemaVersion).toBe(5);
    const loaded = loadProject(raw);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.project.schemaVersion).toBe(6);
    expect('soundFix' in loaded.project).toBe(false);
    // To the byte, in the order the keys were written.
    expect(JSON.stringify({ ...loaded.project, schemaVersion: 5 })).toBe(JSON.stringify(raw));
    // The input itself is not touched.
    expect(raw.schemaVersion).toBe(5);
  });

  it('no older recipe turns the setting on, whatever its number', () => {
    for (const dir of ['legacy-v1', 'legacy-v2', 'legacy-v3', 'legacy-v4', 'legacy-v5']) {
      for (const name of readdirSync(join(FIXTURES, dir))) {
        const loaded = loadProject(fixture(`${dir}/${name}`));
        if (loaded.ok) expect('soundFix' in loaded.project, `${dir}/${name}`).toBe(false);
      }
    }
  });

  it('an older recipe that asks for "Sesi düzelt" was written by no build: it keeps its number and is refused', () => {
    const on = setSoundFix(opened(), true);
    for (const schemaVersion of [1, 2, 3, 4, 5]) {
      const odd = { ...on, schemaVersion };
      expect(migrateProject(odd), `v${schemaVersion}`).toBe(odd);
      expect(issueCodes(loadProject(odd)), `v${schemaVersion}`).toEqual(['schema_version_unsupported']);
    }
    expect(issueCodes(loadProject(fixture('legacy-v5/v5-with-sound-fix.json')))).toEqual(['schema_version_unsupported']);
  });

  it('a stored v5 record with no kesit opens too', () => {
    const noKesit = { ...fixture('legacy-v5/single-clip.json'), clips: [] };
    const loaded = loadStoredProject(noKesit);
    expect(loaded.ok && { ...loaded.project, schemaVersion: 5 }).toEqual(noKesit);
  });
});

describe('round trip: the browser’s store and the backup file', () => {
  it('the setting survives the record through JSON, to the byte — with a kesit and without one', () => {
    const bare = setSoundFix(setVideoAsset(createEmptyProject(), video()), true);
    const cut = setSoundFix(opened(), true);
    for (const project of [bare, cut]) {
      const record = createRecord(project.projectId, 'Sesli', project, []);
      const text = JSON.stringify(record, null, 2);
      const parsed = parseRecord(JSON.parse(text));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.record.edl).toEqual(project);
      expect(parsed.record.edl.soundFix).toEqual({ targetLufs: -16 });
      expect(JSON.stringify(parsed.record, null, 2)).toBe(text);
    }
  });

  it('a record written by the v5 build opens, and saving it again changes the schema number alone', () => {
    for (const name of ['doc10-example.json', 'caption-transcript-speakers.json', 'enhance-light-with-music.json']) {
      const v5 = fixture(`legacy-v5/${name}`);
      const stored = { ...createRecord('p_fixture_001', 'Eski', v5 as unknown as Project, []), updatedAt: '2026-10-20T09:00:00.000Z' };
      const before = JSON.stringify(stored);
      const parsed = parseRecord(JSON.parse(before));
      expect(parsed.ok, name).toBe(true);
      if (!parsed.ok) continue;
      expect(JSON.stringify(parsed.record), name).toBe(before.replace('"schemaVersion":5', '"schemaVersion":6'));
    }
  });
});

describe('the render plan', () => {
  it('carries the request, and nothing about the sound changes when it is off', () => {
    const project = opened();
    const offPlan = plan(project);
    expect(offPlan.soundFix).toBeNull();
    const onPlan = plan(setSoundFix(project, true));
    expect(onPlan.soundFix).toEqual({ targetLufs: -16 });
    // A file made with the chain is another file …
    expect(onPlan.fingerprint).not.toBe(offPlan.fingerprint);
    // … and turning it off again gives back the very plan (and fingerprint) of before.
    expect(plan(setSoundFix(setSoundFix(project, true), false))).toEqual(offPlan);
    // Everything else in the plan is the same: the mix, the frames, the size.
    const { fingerprint: _a, soundFix: _b, ...restOn } = onPlan;
    const { fingerprint: _c, soundFix: _d, ...restOff } = offPlan;
    expect(restOn).toEqual(restOff);
  });

  it('the plan of every recipe without the setting has the fingerprint it had before v6', () => {
    // The fingerprint body has no `soundFix` key unless it is asked for (as with `enhance`).
    const before = plan(opened());
    const asV5 = loadProject({ ...opened(), schemaVersion: 5 });
    if (!asV5.ok) throw new Error('v5 recipe refused');
    expect(plan(asV5.project).fingerprint).toBe(before.fingerprint);
  });

  it('does not stop the picture from being copied (the fast cut): only the sound is re-encoded, as always', () => {
    const source: FastCutSourceFacts = {
      codec: 'avc',
      isobmff: true,
      hdr: false,
      sps: { chromaFormatIdc: 1, bitDepthLuma: 8, bitDepthChroma: 8, frameMbsOnly: true },
      lengthSize: 4,
      displayWidth: 1280,
      displayHeight: 720,
      squarePixels: true,
      fullRange: false,
      wideGamut: false,
      needsReorderFix: false,
    };
    const onPlan = plan(setSoundFix(opened(), true));
    expect(fastCutEligibility(onPlan, source, 'auto')).toEqual(fastCutEligibility(plan(opened()), source, 'auto'));
    expect(fastCutEligibility(onPlan, source, 'auto')).toEqual({ ok: true });
  });
});

/* -------------------------------------------------------------- measuring the mix */

/** A reader that holds a whole constant sound in memory (the writer's view of `AudioStreamReader`). */
function constantReader(value: number, seconds: number, rate = 48_000, channels = 1): AudioStreamReader {
  const frames = Math.round(seconds * rate);
  const buffer = new PcmRingBuffer(channels);
  buffer.append(Array.from({ length: channels }, () => new Float32Array(frames).fill(value)), 0, frames);
  return {
    sampleRate: rate,
    channelCount: channels,
    pcm: buffer,
    open: async () => undefined,
    ensure: async () => undefined,
    release: () => undefined,
  } as unknown as AudioStreamReader;
}

describe('measuring: the writer hands over the mix instead of writing it', () => {
  it('the mix is every kesit at its gain before headroom and clamp; the video’s own sound at full level; nothing is written', async () => {
    const project = setSoundFix(opened(), true);
    const quieter = { ...project, clips: project.clips.map((clip) => ({ ...clip, sourceGainDb: -6 })) };
    const thePlan = plan(quieter);
    const segment = thePlan.segments[0];
    if (!segment) throw new Error('no segment');
    let mixFrames = 0;
    let sourceFrames = 0;
    const mixValues = new Set<number>();
    const sourceValues = new Set<number>();
    const sources: AudioContextSources = {
      clipReader: constantReader(0.9, 10),
      musicReader: null,
      measure: {
        mix: (planar, frames) => {
          mixFrames += frames;
          expect(planar).toHaveLength(2);
          for (const channel of planar) mixValues.add(Math.round((channel[0] ?? 0) * 1e4) / 1e4);
        },
        source: (planar, frames) => {
          sourceFrames += frames;
          for (const channel of planar) sourceValues.add(Math.round((channel[frames - 1] ?? 0) * 1e4) / 1e4);
        },
      },
    };
    let written = 0;
    const writer = new SegmentAudioWriter(thePlan, segment, sources, { add: async () => void (written += 1) }, () => undefined);
    await writer.advanceTo();
    expect(writer.done).toBe(true);
    // Four seconds at 48 kHz, every frame of the moment, once.
    expect(mixFrames).toBe(4 * 48_000);
    expect(sourceFrames).toBe(4 * 48_000);
    // −6 dB of 0.9, not lowered by the −1 dB headroom of an ordinary download (the chain's limiter replaces it).
    expect([...mixValues]).toEqual([Math.round(0.9 * 10 ** (-6 / 20) * 1e4) / 1e4]);
    expect(thePlan.audio.safetyGain).toBeLessThan(1);
    // The recording itself, at full level: what "cut off at full scale" is judged on.
    expect([...sourceValues]).toEqual([0.9]);
    expect(written).toBe(0);
  });

  it('the music is in the mix, never in the recording’s own count', async () => {
    const withMusic = setMusicAsset(setSoundFix(opened(), true), { assetId: 'a_music_001', kind: 'audio', durationUs: 30 * S });
    const thePlan = plan(withMusic);
    const segment = thePlan.segments[0];
    if (!segment || !thePlan.audio.music) throw new Error('no music in the plan');
    const mix: number[] = [];
    const recording: number[] = [];
    const writer = new SegmentAudioWriter(
      thePlan,
      segment,
      {
        clipReader: constantReader(0.2, 10),
        musicReader: constantReader(0.97, 30),
        measure: {
          mix: (planar, frames) => mix.push(planar[0]?.[frames - 1] ?? 0),
          source: (planar, frames) => recording.push(planar[0]?.[frames - 1] ?? 0),
        },
      },
      { add: async () => undefined },
      () => undefined,
    );
    await writer.advanceTo();
    expect(Math.max(...mix)).toBeGreaterThan(0.2);
    expect(new Set(recording.map((value) => Math.round(value * 1e4) / 1e4))).toEqual(new Set([0.2]));
  });

  it('a muted kesit is not in the mix, and not counted as the recording', async () => {
    const project = setSoundFix(opened(), true);
    const muted = { ...project, clips: project.clips.map((clip) => ({ ...clip, muted: true })) };
    const thePlan = plan(muted);
    const segment = thePlan.segments[0];
    if (!segment) throw new Error('no segment');
    let peak = 0;
    let recordingFrames = 0;
    const writer = new SegmentAudioWriter(
      thePlan,
      segment,
      {
        clipReader: constantReader(0.9, 10),
        musicReader: null,
        measure: {
          mix: (planar, frames) => {
            for (const channel of planar) for (let i = 0; i < frames; i += 1) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
          },
          source: (_planar, frames) => void (recordingFrames += frames),
        },
      },
      { add: async () => undefined },
      () => undefined,
    );
    await writer.advanceTo();
    expect(peak).toBe(0);
    expect(recordingFrames).toBe(0);
  });
});
