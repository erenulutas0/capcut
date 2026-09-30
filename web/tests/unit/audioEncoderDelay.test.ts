import { describe, expect, it } from 'vitest';

import {
  AacPacketAligner,
  CALIBRATION,
  aacDescriptionInvalid,
  aacLcAudioSpecificConfig,
  calibrationMarker,
  calibrationSignal,
  findMarkerLag,
  flushPaddingFrames,
  measureEncoderDelay,
} from '@/domain/audioEncoderDelay';
import { durationWithinTolerance } from '@/domain/exportEvents';

const RATE = 48_000;
const AAC_FRAME = 1024;

/** What a decoder gives back from an encoder with `delay` priming frames (and a little coding noise). */
function throughEncoder(signal: Float32Array, delay: number, noise = 0.002, gain = 0.97): Float32Array {
  const out = new Float32Array(signal.length + Math.max(0, delay) + 4096);
  let seed = 7;
  for (let i = 0; i < out.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const source = signal[i - delay] ?? 0;
    out[i] = source * gain + (seed / 0x7fffffff - 0.5) * noise;
  }
  return out;
}

/**
 * Chunk timing of a WebCodecs AAC encoder, as measured (ADR-032): chunks of
 * 1024 frames from timestamp 0, in microseconds rounded like Chrome's.
 * Desktop Chrome: ceil(n / 1024) chunks, no priming. Chrome on Android:
 * ceil((n + 1024) / 1024) chunks, 2048 frames of priming.
 */
function chunkTimes(inputFrames: number, device: 'desktop' | 'android'): { timestampUs: number; durationUs: number }[] {
  const count = device === 'android' ? Math.ceil((inputFrames + 1024) / AAC_FRAME) : Math.ceil(inputFrames / AAC_FRAME);
  return Array.from({ length: count }, (_, k) => ({
    timestampUs: Math.round((k * AAC_FRAME * 1e6) / RATE),
    durationUs: Math.round((AAC_FRAME * 1e6) / RATE),
  }));
}

/** Presented end of the kept packets, in seconds (what the muxer's edit list leaves visible). */
function presentedEnd(aligner: AacPacketAligner, chunks: { timestampUs: number; durationUs: number }[]): number {
  let end = 0;
  for (const chunk of chunks) {
    const placed = aligner.place(chunk.timestampUs, chunk.durationUs);
    if (placed) end = Math.max(end, placed.timestamp + (placed.duration ?? 0));
  }
  return end;
}

describe('calibration signal', () => {
  it('holds the two markers and silence elsewhere', () => {
    const signal = calibrationSignal(RATE);
    const marker = calibrationMarker(RATE);
    expect(signal.length).toBe(CALIBRATION.frames);
    for (const at of CALIBRATION.markers) {
      expect(Array.from(signal.subarray(at, at + marker.length))).toEqual(Array.from(marker));
    }
    expect(signal[CALIBRATION.markers[0] - 1]).toBe(0);
    expect(signal[CALIBRATION.markers[1] + marker.length]).toBe(0);
    expect(Math.max(...Array.from(marker).map(Math.abs))).toBeLessThanOrEqual(0.5);
  });

  it('keeps the markers far enough apart that one cannot be mistaken for the other', () => {
    const [first, second] = CALIBRATION.markers;
    // Searching one marker over the whole lag range never lines it up with the other.
    expect(second - first).toBeGreaterThan(CALIBRATION.maxLag - CALIBRATION.minLag);
  });

  it('finds a chirp at exactly the lag it was moved by', () => {
    const marker = calibrationMarker(RATE);
    const decoded = new Float32Array(20_000);
    decoded.set(marker, 5000 + 333);
    expect(findMarkerLag(marker, decoded, 5000)).toEqual({ lag: 333, correlation: expect.closeTo(1, 6) });
  });
});

describe('measureEncoderDelay', () => {
  it.each([0, 1024, 2048, 2112, 64, -64])('measures a delay of %i frames', (delay) => {
    const result = measureEncoderDelay(throughEncoder(calibrationSignal(RATE), delay), RATE);
    expect(result).toEqual({ ok: true, delayFrames: delay, correlation: expect.any(Number) });
    if (result.ok) expect(result.correlation).toBeGreaterThan(0.99);
  });

  it('refuses when the markers do not come back (silence, or noise)', () => {
    expect(measureEncoderDelay(new Float32Array(CALIBRATION.frames), RATE)).toMatchObject({
      ok: false,
      reason: 'marker_not_found',
    });
    const noise = throughEncoder(new Float32Array(CALIBRATION.frames), 0, 0.5);
    expect(measureEncoderDelay(noise, RATE)).toMatchObject({ ok: false, reason: 'marker_not_found' });
  });

  it('refuses a delay beyond the searched range rather than guessing', () => {
    const result = measureEncoderDelay(throughEncoder(calibrationSignal(RATE), CALIBRATION.maxLag + 500), RATE);
    expect(result.ok).toBe(false);
  });

  it('refuses when the two markers come back at different delays (drifting encoder)', () => {
    const signal = calibrationSignal(RATE);
    const marker = calibrationMarker(RATE);
    const decoded = new Float32Array(signal.length + 8192);
    decoded.set(marker, CALIBRATION.markers[0] + 2048);
    decoded.set(marker, CALIBRATION.markers[1] + 2048 + 40);
    expect(measureEncoderDelay(decoded, RATE)).toMatchObject({ ok: false, reason: 'delay_inconsistent' });
  });
});

describe('AacPacketAligner', () => {
  it('moves Android priming in front of 0 and drops the flush padding (Galaxy S23, kesit 0.5-4 s)', () => {
    const endFrame = 168_000; // 3.5 s at 48 kHz
    const delay = 2048;
    const fed = endFrame + flushPaddingFrames(delay);
    const chunks = chunkTimes(fed, 'android');
    const aligner = new AacPacketAligner(RATE, delay, endFrame);
    const placed = chunks.map((chunk) => aligner.place(chunk.timestampUs, chunk.durationUs));

    expect(placed[0]?.timestamp).toBeCloseTo(-2048 / RATE, 9);
    expect(placed[2]?.timestamp).toBe(0);
    // As measured on the phone: 170 chunks, 167 kept, 3 dropped.
    expect(aligner.stats).toMatchObject({ kept: 167, dropped: 3, coveredTo: 168_960 });
    expect(aligner.complete).toBe(true);
    const kept = placed.filter((p) => p !== null);
    expect(Math.max(...kept.map((p) => p.timestamp))).toBeLessThan(endFrame / RATE);
  });

  it('leaves desktop packets where mediabunny put them (no delay)', () => {
    const endFrame = 168_000;
    const chunks = chunkTimes(endFrame + flushPaddingFrames(0), 'desktop');
    const aligner = new AacPacketAligner(RATE, 0, endFrame);
    const placed = chunks.map((chunk) => aligner.place(chunk.timestampUs, chunk.durationUs));
    const kept = placed.filter((p) => p !== null);
    expect(kept).toHaveLength(Math.ceil(endFrame / AAC_FRAME));
    kept.forEach((packet, k) => {
      expect(packet.timestamp).toBe((k * AAC_FRAME) / RATE);
      expect(packet.duration).toBe(AAC_FRAME / RATE);
    });
    expect(aligner.complete).toBe(true);
  });

  it('says so when the encoder stops before the end of the moment', () => {
    const endFrame = 168_000;
    const aligner = new AacPacketAligner(RATE, 2048, endFrame);
    // An encoder that gave back only what it had without the padding.
    for (const chunk of chunkTimes(endFrame, 'android')) aligner.place(chunk.timestampUs, chunk.durationUs);
    expect(aligner.complete).toBe(false);
  });

  it('keeps every Android export within one output frame of the plan, at any length', () => {
    // The bug: without the correction, lengths just past a 1024-frame step
    // (3.5 s, 7 s) came out 41-43 ms long and were refused at 30 fps.
    for (let frames = 1; frames <= 300; frames += 1) {
      const expectedUs = Math.round((frames * 1e6) / 30);
      const endFrame = Math.round((expectedUs * RATE) / 1e6);

      const fixed = new AacPacketAligner(RATE, 2048, endFrame);
      const fixedEnd = presentedEnd(fixed, chunkTimes(endFrame + flushPaddingFrames(2048), 'android'));
      expect(fixed.complete).toBe(true);
      expect(durationWithinTolerance(expectedUs, Math.round(fixedEnd * 1e6), 30, 1)).toBe(true);
      expect(fixedEnd * RATE).toBeGreaterThanOrEqual(endFrame);
      expect(fixedEnd * RATE).toBeLessThan(endFrame + AAC_FRAME);
    }
  });

  it('reproduces the refusal without the correction (3.5 s and 7 s moments)', () => {
    for (const seconds of [3.5, 7]) {
      const endFrame = seconds * RATE;
      const raw = new AacPacketAligner(RATE, 0, Number.POSITIVE_INFINITY);
      const rawEnd = presentedEnd(raw, chunkTimes(endFrame, 'android'));
      expect(durationWithinTolerance(seconds * 1e6, Math.round(rawEnd * 1e6), 30, 1)).toBe(false);
    }
  });
});

describe('AAC description', () => {
  it('builds the AudioSpecificConfig Chrome itself emits for 48 kHz stereo', () => {
    expect(Array.from(aacLcAudioSpecificConfig(48_000, 2))).toEqual([0x11, 0x90]);
    expect(Array.from(aacLcAudioSpecificConfig(44_100, 2))).toEqual([0x12, 0x10]);
    expect(Array.from(aacLcAudioSpecificConfig(44_100, 1))).toEqual([0x12, 0x08]);
  });

  it('writes an explicit rate that has no table index', () => {
    const config = aacLcAudioSpecificConfig(50_000, 2);
    expect(config).toHaveLength(5);
    expect(config[0]! >> 3).toBe(2);
    expect(((config[0]! & 0x07) << 1) | (config[1]! >> 7)).toBe(15);
  });

  it('flags a missing, short or zero-object-type description', () => {
    expect(aacDescriptionInvalid(null)).toBe(true);
    expect(aacDescriptionInvalid(new Uint8Array([0x11]))).toBe(true);
    expect(aacDescriptionInvalid(new Uint8Array([0x00, 0x00]))).toBe(true);
    expect(aacDescriptionInvalid(new Uint8Array([0x11, 0x90]))).toBe(false);
  });
});

describe('flush padding', () => {
  it('is the delay plus two AAC frames, never negative', () => {
    expect(flushPaddingFrames(0)).toBe(2048);
    expect(flushPaddingFrames(2048)).toBe(4096);
    expect(flushPaddingFrames(-64)).toBe(2048);
  });
});

describe('audioEndFrame', () => {
  it('is where the last moment ends, at the output rate', async () => {
    const { audioEndFrame } = await import('@/adapters/export/segmentAudio');
    const plan = {
      fpsNum: 30,
      fpsDen: 1,
      audio: { sampleRate: RATE },
      segments: [
        { startFrame: 0, endFrame: 105 },
        { startFrame: 105, endFrame: 190 },
      ],
    } as unknown as Parameters<typeof audioEndFrame>[0];
    expect(audioEndFrame(plan)).toBe(Math.round((190 / 30) * RATE));
    expect(audioEndFrame({ ...plan, segments: [] })).toBe(0);
  });
});
