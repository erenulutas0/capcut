import { describe, expect, it } from 'vitest';

import {
  SEEK_SAFE_S,
  SYNC_FPS,
  SYNC_SECONDS,
  onFileTimeline,
  onsets,
  pairFlashes,
  soundEditList,
  syncEventFrames,
  withSoundMediaTime,
} from '../../scripts/lib/av-sync.mjs';

/** ADR-032 sync measurement (scripts/lib/av-sync.mjs): the pure parts. */

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const body = children.reduce((sum, child) => sum + child.length, 0);
  const out = new Uint8Array(8 + body);
  new DataView(out.buffer).setUint32(0, 8 + body);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const child of children) {
    out.set(child, at);
    at += child.length;
  }
  return out;
}

function hdlr(handler: string): Uint8Array {
  const body = new Uint8Array(24);
  for (let i = 0; i < 4; i += 1) body[8 + i] = handler.charCodeAt(i);
  return box('hdlr', body);
}

function elst(mediaTime: number, version: 0 | 1): Uint8Array {
  const body = new Uint8Array(8 + (version === 1 ? 20 : 12));
  const view = new DataView(body.buffer);
  body[0] = version;
  view.setUint32(4, 1);
  if (version === 1) {
    view.setBigUint64(8, 202752n);
    view.setBigInt64(16, BigInt(mediaTime));
    view.setInt16(24, 1);
  } else {
    view.setUint32(8, 202752);
    view.setInt32(12, mediaTime);
    view.setInt16(16, 1);
  }
  return box('elst', body);
}

/** moov with a picture track (its own edit list) and a sound track. */
function movie(sound: Uint8Array[]): Uint8Array {
  return box(
    'moov',
    box('trak', box('edts', elst(1001, 0)), box('mdia', hdlr('vide'))),
    box('trak', ...sound, box('mdia', hdlr('soun'))),
  );
}

describe('sync clip', () => {
  it('puts its events 6 to 13 frames apart, inside the clip', () => {
    const frames = syncEventFrames();
    expect(frames[0]).toBe(9);
    expect(frames.length).toBeGreaterThan(30);
    for (let i = 1; i < frames.length; i += 1) {
      const gap = (frames[i] ?? 0) - (frames[i - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(6);
      expect(gap).toBeLessThanOrEqual(13);
    }
    expect(frames.at(-1)).toBeLessThan(SYNC_SECONDS * SYNC_FPS);
  });
});

describe('onsets', () => {
  it('finds the first loud sample after 100 ms of quiet, to the sample', () => {
    const pcm = new Float32Array(48_000);
    pcm.fill(0.3, 4800, 4900);
    pcm.fill(0.3, 4950, 5000); // 50 ms after the first: the same event
    pcm.fill(-0.4, 24_017, 24_100);
    expect(onsets(pcm)).toEqual([4800 / 48_000, 24_017 / 48_000]);
  });

  it('ignores sound below the threshold', () => {
    const pcm = new Float32Array(48_000).fill(0.01);
    expect(onsets(pcm)).toEqual([]);
  });
});

describe('onFileTimeline (reads near the start without ffmpeg input seek)', () => {
  const ramp = Float32Array.from({ length: 48_000 }, (_, i) => i);

  it('keeps a stream that starts at 0 as decoded', () => {
    expect(Array.from(onFileTimeline(ramp, 0, 0, 0.001))).toEqual(Array.from(ramp.subarray(0, 48)));
  });

  it('puts a stream that starts 2 ms in (Samsung recording) 96 frames late', () => {
    const placed = onFileTimeline(ramp, 0.002, 0, null);
    expect(placed.length).toBe(48_096);
    expect(placed[95]).toBe(0);
    expect(placed[96]).toBe(0);
    expect(placed[97]).toBe(1);
  });

  it('cuts at the start: sample k of the result is file time start + k', () => {
    const placed = onFileTimeline(ramp, 0.002, 0.5, 0.25);
    expect(placed.length).toBe(12_000);
    // File time 0.5 s = frame 24000 = decoded sample 24000 - 96.
    expect(placed[0]).toBe(24_000 - 96);
  });

  it('decodes from the beginning for every start inside the AAC priming', () => {
    // ffmpeg's -ss before -i drops an edit list's priming a second time
    // when it lands inside it: 2048 frames (42.7 ms) on every Android export.
    expect(SEEK_SAFE_S).toBeGreaterThan(2112 / 44_100);
  });
});

describe('pairFlashes', () => {
  it('measures sound minus picture, + = sound late', () => {
    const result = pairFlashes([1, 2, 3], [1.0001, 2.0427, 2.99]);
    expect(result.paired).toBe(3);
    expect(result.minMs).toBe(-10);
    expect(result.medianMs).toBe(0.1);
    expect(result.maxMs).toBe(42.7);
  });

  it('leaves a flash without a sound within 150 ms unpaired', () => {
    expect(pairFlashes([1, 5], [1.2, 5]).paired).toBe(1);
    expect(pairFlashes([], []).medianMs).toBeNull();
  });
});

describe('sound edit list', () => {
  it('reads the sound track’s media_time, not the picture track’s (version 0 and 1)', () => {
    for (const version of [0, 1] as const) {
      const bytes = movie([box('edts', elst(2048, version))]);
      const edit = soundEditList(bytes);
      expect(edit?.mediaTime).toBe(2048);
      expect(edit?.bytes).toBe(version === 1 ? 8 : 4);
    }
  });

  it('is null when the sound track has none (desktop exports)', () => {
    expect(soundEditList(movie([]))).toBeNull();
  });

  it('writes a twin that starts at 0, the same size, the original untouched', () => {
    const bytes = movie([box('edts', elst(2048, 0))]);
    const twin = withSoundMediaTime(bytes, 0);
    expect(twin?.length).toBe(bytes.length);
    expect(soundEditList(twin ?? new Uint8Array())?.mediaTime).toBe(0);
    expect(soundEditList(bytes)?.mediaTime).toBe(2048);
    expect(withSoundMediaTime(movie([]), 0)).toBeNull();
  });
});
