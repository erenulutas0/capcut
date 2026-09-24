import { describe, expect, it } from 'vitest';

import {
  NAL_AUD,
  NAL_IDR,
  NAL_PPS,
  NAL_SLICE,
  NAL_SPS,
  isIdrPacket,
  nalType,
  nalUnits,
  parseAvcC,
  readSps,
  withParameterSets,
} from '@/adapters/export/avcBitstream';

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

/** The GoPro avcC from ADR-014 §3 (also in avcReorder.test.ts): Main, 1280x720. */
const GOPRO_AVCC = hex(
  '014d0028ffe10030274d00289a6280a00b76022000007d20003a981d0c002dc8000337ff77971a18005b9000066ffeef' +
    '2e1f088451e0000001000428ee3c80',
);

/**
 * SPS of an x264 High 4:2:0 8-bit 1920x1080 stream (68 macroblocks high,
 * frame cropping to 1080), from the synthetic fast-cut source.
 */
const X264_1080P_SPS = hex('67640028acd940780227e5c044000003000400000300f03c60c658');

function packet(lengthSize: number, ...nals: Uint8Array[]): Uint8Array {
  const parts: number[] = [];
  for (const nal of nals) {
    for (let i = lengthSize - 1; i >= 0; i -= 1) parts.push((nal.length >> (8 * i)) & 0xff);
    parts.push(...nal);
  }
  return Uint8Array.from(parts);
}

const AUD = Uint8Array.of(0x09, 0xf0);
const SEI = Uint8Array.of(0x06, 0x05, 0x01, 0xff, 0x80);
const IDR_SLICE = Uint8Array.of(0x65, 0x88, 0x84, 0x00, 0x33);
const P_SLICE = Uint8Array.of(0x41, 0x9a, 0x00, 0x11);

describe('parseAvcC', () => {
  it('reads profile, level, NAL length size and the parameter sets', () => {
    const record = parseAvcC(GOPRO_AVCC);
    expect(record).not.toBeNull();
    expect(record?.profileIdc).toBe(77);
    expect(record?.levelIdc).toBe(40);
    expect(record?.lengthSize).toBe(4);
    expect(record?.sps).toHaveLength(1);
    expect(record?.pps).toHaveLength(1);
    expect(nalType(record!.sps[0]!)).toBe(NAL_SPS);
    expect(nalType(record!.pps[0]!)).toBe(NAL_PPS);
  });

  it('rejects something that is not an avcC record', () => {
    expect(parseAvcC(Uint8Array.of(0, 1, 2))).toBeNull();
    expect(parseAvcC(Uint8Array.of(2, 0x4d, 0, 0x28, 0xff, 0xe1, 0, 4))).toBeNull();
    // Declares an SPS longer than the record.
    expect(parseAvcC(Uint8Array.of(1, 0x4d, 0, 0x28, 0xff, 0xe1, 0, 40, 0x67))).toBeNull();
  });
});

describe('readSps', () => {
  it('reads the GoPro SPS: Main, 4:2:0, 8-bit, progressive, 1280x720', () => {
    const sps = readSps(parseAvcC(GOPRO_AVCC)!.sps[0]!);
    expect(sps).toEqual({
      profileIdc: 77,
      levelIdc: 40,
      chromaFormatIdc: 1,
      bitDepthLuma: 8,
      bitDepthChroma: 8,
      frameMbsOnly: true,
      width: 1280,
      height: 720,
    });
  });

  it('applies the frame cropping of a 1088-line coded 1080p High SPS', () => {
    const sps = readSps(X264_1080P_SPS);
    expect(sps?.profileIdc).toBe(100);
    expect(sps?.width).toBe(1920);
    expect(sps?.height).toBe(1080);
    expect(sps?.chromaFormatIdc).toBe(1);
    expect(sps?.bitDepthLuma).toBe(8);
  });

  it('returns null for a non-SPS NAL unit or truncated data', () => {
    expect(readSps(IDR_SLICE)).toBeNull();
    expect(readSps(Uint8Array.of(0x67, 0x64))).toBeNull();
  });
});

describe('packets', () => {
  it('lists the NAL units of a length-prefixed packet and finds IDR slices', () => {
    const idr = packet(4, AUD, SEI, IDR_SLICE);
    expect([...nalUnits(idr, 4)].map(nalType)).toEqual([NAL_AUD, 6, NAL_IDR]);
    expect(isIdrPacket(idr, 4)).toBe(true);
    expect(isIdrPacket(packet(4, SEI, P_SLICE), 4)).toBe(false);
    expect(isIdrPacket(packet(2, IDR_SLICE), 2)).toBe(true);
    // A non-IDR I slice (open GOP) is nal type 1: not an IDR.
    expect(isIdrPacket(packet(4, Uint8Array.of(0x21, 0x88)), 4)).toBe(false);
    expect(nalType(Uint8Array.of(0x21))).toBe(NAL_SLICE);
  });

  it('stops at a length that runs past the packet instead of reading garbage', () => {
    const broken = Uint8Array.of(0, 0, 0, 50, 0x65, 0x88);
    expect([...nalUnits(broken, 4)]).toEqual([]);
    expect(isIdrPacket(broken, 4)).toBe(false);
  });

  it('puts parameter sets in front of the pictures, after an access unit delimiter', () => {
    const record = parseAvcC(GOPRO_AVCC)!;
    const withAud = withParameterSets(packet(4, AUD, IDR_SLICE), 4, record.sps, record.pps);
    expect([...nalUnits(withAud, 4)].map(nalType)).toEqual([NAL_AUD, NAL_SPS, NAL_PPS, NAL_IDR]);
    const plain = withParameterSets(packet(4, SEI, IDR_SLICE), 4, record.sps, record.pps);
    expect([...nalUnits(plain, 4)].map(nalType)).toEqual([NAL_SPS, NAL_PPS, 6, NAL_IDR]);
    // The picture itself is untouched.
    const units = [...nalUnits(plain, 4)];
    expect([...units[3]!]).toEqual([...IDR_SLICE]);
    expect([...units[0]!]).toEqual([...record.sps[0]!]);
  });
});
