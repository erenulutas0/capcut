import { describe, expect, it } from 'vitest';

import {
  avcLengthSize,
  inBandSpsUnderstates,
  raiseAvcReorderDepth,
  readSpsReorder,
  reorderDepth,
} from '@/adapters/export/avcReorder';

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

/**
 * The avcC record (codec configuration only, no picture data) of the GoPro
 * Ambarella sample from ADR-014 §3: Main profile, 1280x720, VUI with
 * bitstream_restriction_flag = 1, max_num_reorder_frames = 1,
 * max_dec_frame_buffering = 6. The SPS carries trailing zero bytes.
 */
const GOPRO_AVCC = hex(
  '014d0028ffe10030274d00289a6280a00b76022000007d20003a981d0c002dc8000337ff77971a18005b9000066ffeef' +
    '2e1f088451e0000001000428ee3c80',
);
/** The same record after raising the reorder depth to 2 (checked with ffmpeg trace_headers). */
const GOPRO_AVCC_REORDER_2 = hex(
  '014d0028ffe1002e274d00289a6280a00b76022000007d20003a981d0c002dc8000337ff77971a18005b9000066ffeef' +
    '2e1f088459e001000428ee3c80',
);

function firstSps(avcC: Uint8Array): Uint8Array {
  const length = ((avcC[6] ?? 0) << 8) | (avcC[7] ?? 0);
  return avcC.subarray(8, 8 + length);
}

describe('reorderDepth', () => {
  it('measures the GoPro pattern: IDR, then B-frames shown before it', () => {
    // First two GOP groups of the real file, decode order, in 90 kHz ticks.
    const pts = [4504, 1501, 0, 3003, 10510, 7507, 6006, 9009, 16516, 13513, 12012, 15015];
    expect(reorderDepth(pts)).toBe(2);
  });

  it('is 0 without B-frames and 1 for a plain IBBP pattern', () => {
    expect(reorderDepth([0, 1, 2, 3, 4])).toBe(0);
    expect(reorderDepth([0, 3, 1, 2, 6, 4, 5, 9, 7, 8])).toBe(1);
    expect(reorderDepth([])).toBe(0);
  });

  it('ignores a one-off timestamp glitch (the M06 concat join)', () => {
    // IBBP groups, then one frame whose timestamp lands before four earlier ones.
    const pts = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8, 12, 10, 11, 5.5, 15, 13, 14];
    expect(reorderDepth(pts)).toBe(1);
    expect(reorderDepth(pts, 1)).toBeGreaterThanOrEqual(4);
  });
});

describe('raiseAvcReorderDepth', () => {
  it('reads the declared reorder fields of the GoPro SPS', () => {
    const info = readSpsReorder(firstSps(GOPRO_AVCC));
    expect(info).toMatchObject({ maxNumReorderFrames: 1, maxDecFrameBuffering: 6 });
  });

  it('rewrites only the reorder fields, keeping every earlier bit and the PPS', () => {
    const fixed = raiseAvcReorderDepth(GOPRO_AVCC, 2);
    expect(fixed).toEqual(GOPRO_AVCC_REORDER_2);
    expect(readSpsReorder(firstSps(fixed ?? new Uint8Array()))).toMatchObject({
      maxNumReorderFrames: 2,
      maxDecFrameBuffering: 6,
    });
  });

  it('raises max_dec_frame_buffering with a deeper reorder, and caps at 16', () => {
    const fixed = raiseAvcReorderDepth(GOPRO_AVCC, 40);
    expect(readSpsReorder(firstSps(fixed ?? new Uint8Array()))).toMatchObject({
      maxNumReorderFrames: 16,
      maxDecFrameBuffering: 16,
    });
  });

  it('leaves a truthful stream untouched', () => {
    expect(raiseAvcReorderDepth(GOPRO_AVCC, 1)).toBeNull();
    expect(raiseAvcReorderDepth(GOPRO_AVCC, 0)).toBeNull();
    expect(raiseAvcReorderDepth(GOPRO_AVCC_REORDER_2, 2)).toBeNull();
  });

  it('gives up on records it cannot read instead of guessing', () => {
    expect(raiseAvcReorderDepth(new Uint8Array([1, 2, 3]), 2)).toBeNull();
    expect(raiseAvcReorderDepth(GOPRO_AVCC.subarray(0, 20), 2)).toBeNull();
  });
});

describe('inBandSpsUnderstates', () => {
  const lengthPrefixed = (...nals: Uint8Array[]) => {
    const parts: number[] = [];
    for (const nal of nals) parts.push(0, 0, nal.length >> 8, nal.length & 0xff, ...nal);
    return Uint8Array.from(parts);
  };
  const slice = Uint8Array.of(0x65, 0x88, 0x84, 0x00);

  it('finds an understated SPS repeated inside a key packet', () => {
    expect(avcLengthSize(GOPRO_AVCC)).toBe(4);
    const packet = lengthPrefixed(firstSps(GOPRO_AVCC), slice);
    expect(inBandSpsUnderstates(packet, 4, 2)).toBe(true);
    expect(inBandSpsUnderstates(packet, 4, 1)).toBe(false);
  });

  it('ignores packets without an SPS or with a truthful one', () => {
    expect(inBandSpsUnderstates(lengthPrefixed(slice), 4, 2)).toBe(false);
    expect(inBandSpsUnderstates(lengthPrefixed(firstSps(GOPRO_AVCC_REORDER_2), slice), 4, 2)).toBe(false);
  });
});
