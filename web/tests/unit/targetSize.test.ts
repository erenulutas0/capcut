import { describe, expect, it } from 'vitest';

import { audioFileName, audioOnlyBytes, audioOnlyRecipe } from '@/domain/audioOnly';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import type { Project } from '@/domain/edl';
import { AacPacketAligner } from '@/domain/audioEncoderDelay';
import type { VideoEncoderKind } from '@/domain/encoderBitrate';
import { audioDurationWithinTolerance } from '@/domain/exportEvents';
import { formatByteLimit, formatBytesAgainstLimit } from '@/domain/policy';
import { videoBitrateFor, type RenderPlan } from '@/domain/renderPlan';
import { CHROMIUM_SHARE_MAX_BYTES } from '@/domain/share';
import {
  DEFAULT_MIN_SHORT_EDGE,
  MAX_TARGET_ATTEMPTS,
  REFUSE_BITS_PER_PIXEL,
  SIZE_PRESETS,
  STEP_DOWN_BITS_PER_PIXEL,
  TARGET_AUDIO_BITRATES,
  TARGET_SHORT_EDGES,
  VIDEO_OVERSHOOT,
  baseFingerprint,
  containerOverheadBytes,
  correctTargetSize,
  estimateEncodeSeconds,
  maxTargetShortEdge,
  nativeShortEdge,
  planForTargetSize,
  planTargetSize,
  sizePreset,
  targetShortEdges,
  type TargetSizeDecision,
  type TargetSizeFacts,
} from '@/domain/targetSize';

const SECOND = 1_000_000;

function facts(overrides: Partial<TargetSizeFacts> & { kind?: VideoEncoderKind } = {}): TargetSizeFacts {
  const { kind = 'hardware', ...rest } = overrides;
  return {
    durationUs: 60 * SECOND,
    aspect: '16:9',
    fpsNum: 30,
    fpsDen: 1,
    maxShortEdge: 1080,
    audioSampleRate: 48_000,
    encoderKind: () => kind,
    ...rest,
  };
}

function decided(plan: ReturnType<typeof planTargetSize>): TargetSizeDecision {
  if (!plan.ok) throw new Error(`refused: needs ${plan.minBytes}`);
  return plan;
}

/** Bits per pixel and frame of a decision. */
function bpp(decision: TargetSizeDecision, fps = 30): number {
  return decision.videoBitrate / (decision.width * decision.height * fps);
}

describe('size presets (ADR-035)', () => {
  it('are bytes, with the share limit equal to the measured Chromium limit (ADR-031)', () => {
    expect(sizePreset('share').bytes).toBe(52_428_800);
    expect(sizePreset('share').bytes).toBe(CHROMIUM_SHARE_MAX_BYTES);
    expect(sizePreset('whatsapp').bytes).toBe(16_000_000);
    expect(sizePreset('email').bytes).toBe(25_000_000);
    expect(SIZE_PRESETS.map((preset) => preset.id).sort()).toEqual(['email', 'share', 'whatsapp']);
  });

  it('shows a size under the target as under it and one over as over (byte units, ADR-030)', () => {
    const target = sizePreset('share').bytes;
    expect(formatByteLimit(target, ',')).toBe('52,4 MB');
    expect(formatBytesAgainstLimit(target, target, ',')).toBe('52,4 MB');
    expect(formatBytesAgainstLimit(target + 1, target, ',')).toBe('52,5 MB');
    expect(formatBytesAgainstLimit(48_200_000, target, ',')).toBe('48,2 MB');
  });
});

describe('the resolution ladder', () => {
  it('goes 1080 -> 720 -> 540 -> 360 (480p never won a measurement, ADR-035)', () => {
    expect([...TARGET_SHORT_EDGES]).toEqual([1080, 720, 540, 360]);
    expect(DEFAULT_MIN_SHORT_EDGE).toBe(360);
    expect(targetShortEdges(1080)).toEqual([1080, 720, 540, 360]);
    expect(targetShortEdges(720)).toEqual([720, 540, 360]);
    expect(targetShortEdges(1080, 720)).toEqual([1080, 720]);
  });

  it('keeps the floor itself when nothing lies between the floor and the cap', () => {
    expect(targetShortEdges(540, 720)).toEqual([720]);
    expect(targetShortEdges(360)).toEqual([360]);
  });

  it('never encodes a rung larger than the first one that holds the source picture', () => {
    expect(maxTargetShortEdge(1080, 1080)).toBe(1080);
    expect(maxTargetShortEdge(1080, 2160)).toBe(1080);
    expect(maxTargetShortEdge(1080, 608)).toBe(720);
    expect(maxTargetShortEdge(1080, 480)).toBe(540);
    expect(maxTargetShortEdge(1080, 128)).toBe(360);
    expect(maxTargetShortEdge(720, 1080)).toBe(720);
    expect(maxTargetShortEdge(1080, null)).toBe(1080);
  });

  it('reads the real pixels across the frame from the plan (crop and fit)', () => {
    const segment = { fit: 'cover' as const, crop: { x: 656, y: 0, width: 608, height: 1080 } };
    const plan = { width: 1080, height: 1920, segments: [segment] } as unknown as RenderPlan;
    // A 1080p landscape recording cropped to 9:16 has 608 real pixels across.
    expect(nativeShortEdge(plan)).toBe(608);
    const whole = { fit: 'cover' as const, crop: { x: 0, y: 0, width: 1920, height: 1080 } };
    expect(nativeShortEdge({ width: 1280, height: 720, segments: [whole] } as unknown as RenderPlan)).toBe(1080);
    expect(nativeShortEdge({ width: 1280, height: 720, segments: [] } as unknown as RenderPlan)).toBeNull();
  });
});

describe('planTargetSize', () => {
  it('keeps the ordinary download when it already fits (hardware: the plan bitrate)', () => {
    const plan = decided(planTargetSize({ targetBytes: 52_428_800 }, facts({ durationUs: 30 * SECOND })));
    expect(plan.mode).toBe('normal');
    expect(plan.shortEdge).toBe(1080);
    expect(plan.videoBitrate).toBe(videoBitrateFor(1920, 1080, 30));
    expect(plan.audioBitrate).toBe(128_000);
    expect(plan.plannedBytes).toBeLessThan(52_428_800);
  });

  it('never asks the software encoder for more than its ordinary 3x bitrate (ADR-024), and applies no factor below it', () => {
    const roomy = decided(planTargetSize({ targetBytes: 500_000_000 }, facts({ kind: 'software', durationUs: 30 * SECOND })));
    expect(roomy.mode).toBe('normal');
    expect(roomy.videoBitrate).toBe(3 * videoBitrateFor(1920, 1080, 30));
    const tight = decided(planTargetSize({ targetBytes: 20_000_000 }, facts({ kind: 'software', durationUs: 60 * SECOND })));
    expect(tight.mode).toBe('reduced');
    // The whole budget, bitrates over the length plus the container, stays under the target.
    const nominal = ((tight.videoBitrate * VIDEO_OVERSHOOT.software + tight.audioBitrate) * 60) / 8;
    expect(nominal).toBeLessThanOrEqual(20_000_000);
  });

  it('lowers the bitrate first, then steps the resolution down at the measured floor', () => {
    const seconds = 120;
    const f = facts({ durationUs: seconds * SECOND });
    let last = 1080;
    const seen: number[] = [];
    for (let megabytes = 60; megabytes >= 3; megabytes -= 1) {
      const plan = planTargetSize({ targetBytes: megabytes * 1_000_000 }, f);
      if (!plan.ok) break;
      // Never back up to a larger size for a smaller target.
      expect(plan.shortEdge).toBeLessThanOrEqual(last);
      last = plan.shortEdge;
      if (!seen.includes(plan.shortEdge)) seen.push(plan.shortEdge);
      // A size that is not the smallest is never used under its step-down floor.
      if (plan.shortEdge !== 360) expect(bpp(plan)).toBeGreaterThanOrEqual(STEP_DOWN_BITS_PER_PIXEL.hardware - 1e-9);
      else expect(bpp(plan)).toBeGreaterThanOrEqual(REFUSE_BITS_PER_PIXEL.hardware - 1e-9);
      expect(plan.plannedBytes).toBeLessThanOrEqual(megabytes * 1_000_000);
    }
    expect(seen).toEqual([1080, 720, 540, 360]);
  });

  it('steps down exactly at the floor: one bit per second under it picks the next size', () => {
    const f = facts({ durationUs: 100 * SECOND });
    const floor1080 = Math.ceil(1920 * 1080 * 30 * STEP_DOWN_BITS_PER_PIXEL.hardware);
    const overhead = containerOverheadBytes({ durationUs: f.durationUs, fps: 30, audioSampleRate: 48_000 });
    /** The target whose video budget is exactly `bitrate` at 128 kbit/s audio. */
    const targetFor = (bitrate: number) =>
      Math.ceil((((bitrate * VIDEO_OVERSHOOT.hardware + 128_000) * 100) / 8 + overhead) / 0.99);
    expect(decided(planTargetSize({ targetBytes: targetFor(floor1080) + 2 }, f)).shortEdge).toBe(1080);
    expect(decided(planTargetSize({ targetBytes: targetFor(floor1080 - 2_000) }, f)).shortEdge).toBe(720);
  });

  it('uses each encoder class’s own measured floors and overshoot', () => {
    expect(STEP_DOWN_BITS_PER_PIXEL).toEqual({ hardware: 0.04, software: 0.07 });
    expect(REFUSE_BITS_PER_PIXEL).toEqual({ hardware: 0.025, software: 0.07 });
    expect(VIDEO_OVERSHOOT).toEqual({ hardware: 1.1, software: 1.02 });
    for (const kind of ['hardware', 'software'] as const) {
      const f = facts({ durationUs: 100 * SECOND, kind });
      const floor = Math.ceil(1920 * 1080 * 30 * STEP_DOWN_BITS_PER_PIXEL[kind]);
      const overhead = containerOverheadBytes({ durationUs: f.durationUs, fps: 30, audioSampleRate: 48_000 });
      const targetFor = (bitrate: number) =>
        Math.ceil((((bitrate * VIDEO_OVERSHOOT[kind] + 128_000) * 100) / 8 + overhead) / 0.99);
      const at = decided(planTargetSize({ targetBytes: targetFor(floor) + 2 }, f));
      expect([at.shortEdge, at.encoderKind]).toEqual([1080, kind]);
      expect(at.videoBitrate).toBeGreaterThanOrEqual(floor);
      expect(decided(planTargetSize({ targetBytes: targetFor(floor - 2_000) }, f)).shortEdge).toBe(720);
    }
  });

  it('asks each size for the encoder that size really has', () => {
    // Hardware for 1080p and 720p, software below (as a GPU with a minimum size would answer).
    const f = facts({ durationUs: 120 * SECOND, encoderKind: (width) => (width >= 1280 ? 'hardware' : 'software') });
    const plan = decided(planTargetSize({ targetBytes: 12_000_000 }, f));
    expect(plan.encoderKind).toBe(plan.width >= 1280 ? 'hardware' : 'software');
  });

  it('keeps 128 kbit/s audio while anything fits with it, then 96 (the lowest the browsers encode)', () => {
    expect([...TARGET_AUDIO_BITRATES]).toEqual([128_000, 96_000]);
    const f = facts({ durationUs: 60 * SECOND, maxShortEdge: 360 });
    const floor = Math.ceil(640 * 360 * 30 * REFUSE_BITS_PER_PIXEL.hardware);
    const overhead = containerOverheadBytes({ durationUs: f.durationUs, fps: 30, audioSampleRate: 48_000 });
    const targetFor = (audio: number, slackBits: number) =>
      Math.ceil((((floor * VIDEO_OVERSHOOT.hardware + audio + slackBits) * 60) / 8 + overhead) / 0.99);
    expect(decided(planTargetSize({ targetBytes: targetFor(128_000, 1_000) }, f)).audioBitrate).toBe(128_000);
    expect(decided(planTargetSize({ targetBytes: targetFor(96_000, 1_000) }, f)).audioBitrate).toBe(96_000);
    expect(planTargetSize({ targetBytes: targetFor(96_000, -2_000) }, f).ok).toBe(false);
  });

  it('plans only with the audio bitrates the browser can really write', () => {
    const f = facts({ durationUs: 60 * SECOND, maxShortEdge: 360 });
    const floor = Math.ceil(640 * 360 * 30 * REFUSE_BITS_PER_PIXEL.hardware);
    const overhead = containerOverheadBytes({ durationUs: f.durationUs, fps: 30, audioSampleRate: 48_000 });
    // Fits with 96 kbit/s audio, not with 128.
    const target = { targetBytes: Math.ceil((((floor * VIDEO_OVERSHOOT.hardware + 97_000) * 60) / 8 + overhead) / 0.99) };
    expect(decided(planTargetSize(target, f)).audioBitrate).toBe(96_000);
    // Chrome on Android (measured): 96 kbit/s cannot be aligned, so only 128 is planned with.
    const only128 = planTargetSize(target, { ...f, audioBitrates: [128_000] });
    expect(only128.ok).toBe(false);
    if (!only128.ok) {
      expect(decided(planTargetSize({ targetBytes: only128.minBytes }, { ...f, audioBitrates: [128_000] })).audioBitrate).toBe(128_000);
    }
  });

  it('never refuses or steps down for needing more bits than the source itself has', () => {
    // 10 minutes that weigh 6 MB (80 kbit/s): plain, long, already small.
    const f = facts({ durationUs: 600 * SECOND, kind: 'software' });
    const target = { targetBytes: 16_000_000 };
    expect(planTargetSize(target, f).ok).toBe(false);
    const known = decided(planTargetSize(target, { ...f, sourceBitrate: 80_000 }));
    expect(known.shortEdge).toBe(1080);
    expect(known.plannedBytes).toBeLessThanOrEqual(16_000_000);
    // A detailed source keeps the measured floors.
    expect(planTargetSize(target, { ...f, sourceBitrate: 12_000_000 }).ok).toBe(false);
  });

  it('plans no audio bytes for a download without sound', () => {
    const silent = decided(planTargetSize({ targetBytes: 3_000_000 }, facts({ audioSampleRate: null })));
    const loud = decided(planTargetSize({ targetBytes: 3_000_000 }, facts()));
    expect(silent.audioBitrate).toBe(0);
    expect(silent.videoBitrate).toBeGreaterThan(loud.videoBitrate);
  });

  it('refuses an impossible target with the smallest size and the longest length that work', () => {
    const f = facts({ durationUs: 10 * 60 * SECOND });
    const refused = planTargetSize({ targetBytes: 2_000_000 }, f);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe('target_too_small');
    expect(refused.shortEdge).toBe(360);
    expect(refused.minBytes).toBeGreaterThan(2_000_000);
    // The smallest size it names is accepted, one kilobyte less is not.
    const atMin = decided(planTargetSize({ targetBytes: refused.minBytes }, f));
    expect(atMin.shortEdge).toBe(360);
    expect(atMin.audioBitrate).toBe(96_000);
    expect(planTargetSize({ targetBytes: refused.minBytes - 1_000 }, f).ok).toBe(false);
    // The longest length it names fits the original target; a second more does not.
    expect(refused.maxDurationUs).toBeGreaterThan(0);
    expect(refused.maxDurationUs).toBeLessThan(f.durationUs);
    expect(planTargetSize({ targetBytes: 2_000_000 }, { ...f, durationUs: refused.maxDurationUs }).ok).toBe(true);
    expect(planTargetSize({ targetBytes: 2_000_000 }, { ...f, durationUs: refused.maxDurationUs + SECOND }).ok).toBe(false);
  });

  it('with a 720p floor refuses what 360p would have taken', () => {
    const f = facts({ durationUs: 120 * SECOND });
    const target = { targetBytes: 6_000_000 };
    expect(decided(planTargetSize(target, f)).shortEdge).toBeLessThan(720);
    const refused = planTargetSize({ ...target, minShortEdge: 720 }, f);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.shortEdge).toBe(720);
  });

  it('counts the container: the planned size holds the bitrates, the length and the tables', () => {
    expect(containerOverheadBytes({ durationUs: 10 * SECOND, fps: 30, audioSampleRate: 48_000 })).toBeGreaterThanOrEqual(4454);
    expect(containerOverheadBytes({ durationUs: 4 * SECOND, fps: 30, audioSampleRate: 48_000 })).toBeGreaterThanOrEqual(2502);
    expect(containerOverheadBytes({ durationUs: 10 * SECOND, fps: 30, audioSampleRate: null })).toBeLessThan(
      containerOverheadBytes({ durationUs: 10 * SECOND, fps: 30, audioSampleRate: 48_000 }),
    );
  });
});

describe('correctTargetSize', () => {
  const request = { targetBytes: 10_000_000 };
  const f = facts({ durationUs: 60 * SECOND });
  const first = decided(planTargetSize(request, f));
  const asked = (first.videoBitrate * 60) / 8;

  it('does nothing for a file at or under the target', () => {
    expect(correctTargetSize(request, f, first, { fileBytes: 10_000_000, videoBytes: 9_000_000 })).toBeNull();
  });

  it('slightly over: the same size with the bitrate scaled to what the video may weigh', () => {
    const videoBytes = Math.round(asked * 1.2);
    const fileBytes = videoBytes + 970_000;
    expect(fileBytes).toBeGreaterThan(request.targetBytes);
    const next = correctTargetSize(request, f, first, { fileBytes, videoBytes });
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.attempt).toBe(2);
    expect(next.shortEdge).toBe(first.shortEdge);
    expect(next.audioBitrate).toBe(first.audioBitrate);
    expect(next.videoBitrate).toBeLessThan(first.videoBitrate);
    // At the measured ratio the retry lands 3% under the target.
    const predicted = ((next.videoBitrate * 60) / 8) * 1.2 + 970_000;
    expect(predicted).toBeLessThanOrEqual(request.targetBytes * 0.97 + 1);
    expect(predicted).toBeGreaterThan(request.targetBytes * 0.96);
  });

  it('far over (a saturated encoder): the largest smaller size whose pixels fit', () => {
    // A 1080p attempt that made 2.4x what it was asked for: asking for less at this size is no use.
    const big = { targetBytes: 40_000_000 };
    const top = decided(planTargetSize(big, f));
    expect(top.shortEdge).toBe(1080);
    const videoBytes = Math.round(((top.videoBitrate * 60) / 8) * 2.4);
    const other = 970_000;
    const next = correctTargetSize(big, f, top, { fileBytes: videoBytes + other, videoBytes });
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.attempt).toBe(2);
    // 720p would be predicted at 0.44x the bytes (+20%): too much. 540p (0.25x) fits.
    const budget = big.targetBytes * 0.97 - other;
    const perPixel = videoBytes / (1920 * 1080);
    expect(perPixel * 1280 * 720 * 1.2).toBeGreaterThan(budget);
    expect(perPixel * 960 * 540 * 1.2).toBeLessThanOrEqual(budget);
    expect([next.shortEdge, next.width, next.height]).toEqual([540, 960, 540]);
  });

  it('a saturated encoder that fits nowhere still gets the smallest size, once', () => {
    const videoBytes = Math.round(asked * 3);
    const next = correctTargetSize(request, f, first, { fileBytes: videoBytes + 970_000, videoBytes });
    expect(next?.shortEdge).toBe(360);
    expect(next?.attempt).toBe(2);
  });

  it('gives up after the last attempt, and at the smallest size when the encoder is saturated', () => {
    const lastTry = { ...first, attempt: MAX_TARGET_ATTEMPTS };
    expect(correctTargetSize(request, f, lastTry, { fileBytes: 12_000_000, videoBytes: 11_000_000 })).toBeNull();
    const smallest = { ...first, shortEdge: 360, width: 640, height: 360, videoBitrate: 300_000 };
    const saturated = { fileBytes: 12_000_000, videoBytes: Math.round(((300_000 * 60) / 8) * 4) };
    expect(correctTargetSize(request, f, smallest, saturated)).toBeNull();
  });

  it('counts attempts up to the limit', () => {
    expect(MAX_TARGET_ATTEMPTS).toBe(3);
    let decision: TargetSizeDecision | null = first;
    let attempts = 1;
    while (decision) {
      const videoBytes = Math.round(((decision.videoBitrate * 60) / 8) * 1.25);
      decision = correctTargetSize(request, f, decision, { fileBytes: request.targetBytes + 1, videoBytes });
      if (decision) attempts = decision.attempt;
    }
    expect(attempts).toBe(MAX_TARGET_ATTEMPTS);
  });
});

describe('the plan for a decision', () => {
  const base = {
    fingerprint: 'fp_0123abcd',
    width: 1920,
    height: 1080,
    videoBitrate: 5_598_720,
    audioBitrate: 128_000,
    totalFrames: 1800,
    segments: [],
  } as unknown as RenderPlan;

  it('changes the size and the bitrates and nothing else, with its own fingerprint', () => {
    const decision = decided(planTargetSize({ targetBytes: 8_000_000 }, facts()));
    const plan = planForTargetSize(base, decision);
    expect([plan.width, plan.height]).toEqual([decision.width, decision.height]);
    expect(plan.videoBitrate).toBe(decision.videoBitrate);
    expect(plan.audioBitrate).toBe(decision.audioBitrate);
    expect(plan.totalFrames).toBe(base.totalFrames);
    expect(plan.fingerprint).toBe('fp_0123abcd.ts8000000');
    expect(baseFingerprint(plan.fingerprint)).toBe('fp_0123abcd');
    expect(baseFingerprint('fp_0123abcd')).toBe('fp_0123abcd');
    // Planning again from an already planned plan does not stack suffixes.
    expect(planForTargetSize(plan, decision).fingerprint).toBe('fp_0123abcd.ts8000000');
  });

  it('gives a rough time that grows with the pixels and is slower in software', () => {
    const hd = { width: 1920, height: 1080 };
    const fast = estimateEncodeSeconds({ ...hd, encoderKind: 'hardware' }, 1800);
    const slow = estimateEncodeSeconds({ ...hd, encoderKind: 'software' }, 1800);
    expect(slow).toBeGreaterThan(fast);
    expect(estimateEncodeSeconds({ width: 640, height: 360, encoderKind: 'hardware' }, 1800)).toBeLessThanOrEqual(fast);
    expect(estimateEncodeSeconds({ ...hd, encoderKind: 'hardware' }, 0)).toBe(1);
    // Measured: 60 s of 1080p took 10.9 s (hardware) and 27.8 s (software); 5 min 41 s at 360p took 24.5 s (hardware).
    expect(fast).toBe(12);
    expect(slow).toBe(28);
    expect(estimateEncodeSeconds({ width: 640, height: 360, encoderKind: 'hardware' }, 10_230)).toBe(26);
  });
});

describe('sound-only helpers (ADR-035)', () => {
  it('names the file .m4a', () => {
    expect(audioFileName('tatil_3-kesit.mp4')).toBe('tatil_3-kesit.m4a');
    expect(audioFileName('tatil_00-12-01-40.mp4')).toBe('tatil_00-12-01-40.m4a');
    expect(audioFileName('adsiz')).toBe('adsiz.m4a');
  });

  it('compiles on the sample grid: a kesit that is not a whole number of frames keeps its exact length', () => {
    const project = {
      schemaVersion: 2,
      revision: 1,
      assets: [{ assetId: 'a', kind: 'video', durationUs: 12 * SECOND, displayWidth: 1280, displayHeight: 720, hasAudio: true }],
      clips: [
        {
          clipId: 'c1',
          assetId: 'a',
          sourceInUs: 2_500_000,
          sourceOutUs: 9_250_000,
          sourceGainDb: 0,
          muted: false,
          view: { x: 0, y: 0, width: 1, height: 1, fit: 'cover' },
        },
      ],
      music: null,
      canvas: { aspect: '16:9', background: '#000000' },
      export: {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        shortEdge: 720,
        fpsNum: 30,
        fpsDen: 1,
        colorMode: 'sdr_rec709',
        audioSampleRate: 48_000,
      },
      captionTracks: [],
    } as unknown as Project;
    const video = compileRenderPlan(project, WEB_LOCAL_POLICY);
    const audio = compileRenderPlan(audioOnlyRecipe(project), WEB_LOCAL_POLICY);
    expect(video.ok && audio.ok).toBe(true);
    if (!video.ok || !audio.ok) return;
    // 6.75 s is 202.5 frames: the video is 203 frames long, the sound file 6.75 s.
    expect(video.plan.expectedDurationUs).toBe(6_766_667);
    expect(audio.plan.expectedDurationUs).toBe(6_750_000);
    expect(audio.plan.totalFrames).toBe(324_000);
    expect(audio.plan.audio.sampleRate).toBe(48_000);
  });

  it('estimates the size from the AAC bitrate and the length', () => {
    expect(audioOnlyBytes({ audioBitrate: 128_000, expectedDurationUs: 60 * SECOND })).toBe(960_000);
    expect(audioOnlyBytes({ audioBitrate: 128_000, expectedDurationUs: 3600 * SECOND })).toBe(57_600_000);
  });

  it('accepts a duration within one AAC frame only', () => {
    expect(audioDurationWithinTolerance(4 * SECOND, 4 * SECOND, 48_000)).toBe(true);
    expect(audioDurationWithinTolerance(4 * SECOND, 4 * SECOND + 21_000, 48_000)).toBe(true);
    expect(audioDurationWithinTolerance(4 * SECOND, 4 * SECOND + 22_000, 48_000)).toBe(false);
    expect(audioDurationWithinTolerance(4 * SECOND, 4 * SECOND - 22_000, 48_000)).toBe(false);
  });

  it('cuts the last AAC packet at the end, so the track is exact to the sample', () => {
    const rate = 48_000;
    const endFrame = 4 * rate; // 187.5 AAC frames
    const run = (trim: boolean, delay: number) => {
      const aligner = new AacPacketAligner(rate, delay, endFrame, trim);
      let end = 0;
      let kept = 0;
      for (let frame = 0; frame < endFrame + delay + 4096; frame += 1024) {
        const placed = aligner.place(Math.round((frame * 1e6) / rate), Math.round((1024 * 1e6) / rate));
        if (!placed) continue;
        kept += 1;
        end = Math.max(end, placed.timestamp + (placed.duration ?? 0));
      }
      return { end, kept, complete: aligner.complete };
    };
    // Desktop (no delay) and Android (2048 priming frames): both end exactly at 4 s.
    for (const delay of [0, 2048]) {
      const trimmed = run(true, delay);
      expect(trimmed.end).toBeCloseTo(4, 9);
      expect(trimmed.complete).toBe(true);
      // Without the cut (the video download) the track ends on the next whole AAC frame.
      const whole = run(false, delay);
      expect(whole.end).toBeCloseTo(192_512 / rate, 9);
      expect(whole.kept).toBe(trimmed.kept);
    }
  });
});
