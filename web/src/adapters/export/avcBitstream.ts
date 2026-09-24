/**
 * Small, exact H.264 bitstream helpers for the fast cut (ADR-027).
 *
 * The fast cut copies the source's own compressed pictures into the output
 * and re-encodes only the few frames next to a cut. Two parameter-set
 * configurations then live in one track: the source's and the seam
 * encoder's. Both are carried in-band — each run of pictures starts with an
 * IDR that has its own SPS/PPS in front of it — so a decoder always has the
 * right set active. Nothing here changes a picture: NAL units are only read,
 * or parameter sets are put in front of an IDR's slices.
 *
 * Packets are in the MP4 (AVCC) layout: every NAL unit is prefixed with its
 * length in `lengthSize` bytes.
 */

import { BitReader, unescapeRbsp } from './avcReorder';

export const NAL_SLICE = 1;
export const NAL_IDR = 5;
export const NAL_SEI = 6;
export const NAL_SPS = 7;
export const NAL_PPS = 8;
export const NAL_AUD = 9;

export interface AvcConfigRecord {
  profileIdc: number;
  profileCompatibility: number;
  levelIdc: number;
  /** NAL length prefix in the packets: 1, 2 or 4 bytes. */
  lengthSize: number;
  sps: Uint8Array[];
  pps: Uint8Array[];
}

/** Parses an AVCDecoderConfigurationRecord (the `avcC` box payload). */
export function parseAvcC(avcC: Uint8Array): AvcConfigRecord | null {
  if (avcC.length < 7 || avcC[0] !== 1) return null;
  const lengthSize = ((avcC[4] ?? 3) & 0b11) + 1;
  const sps: Uint8Array[] = [];
  const pps: Uint8Array[] = [];
  let offset = 5;
  const spsCount = (avcC[offset] ?? 0) & 0x1f;
  offset += 1;
  for (let i = 0; i < spsCount; i += 1) {
    const length = ((avcC[offset] ?? 0) << 8) | (avcC[offset + 1] ?? 0);
    const nal = avcC.subarray(offset + 2, offset + 2 + length);
    if (nal.length !== length || length === 0) return null;
    sps.push(nal);
    offset += 2 + length;
  }
  const ppsCount = avcC[offset] ?? 0;
  offset += 1;
  for (let i = 0; i < ppsCount; i += 1) {
    const length = ((avcC[offset] ?? 0) << 8) | (avcC[offset + 1] ?? 0);
    const nal = avcC.subarray(offset + 2, offset + 2 + length);
    if (nal.length !== length || length === 0) return null;
    pps.push(nal);
    offset += 2 + length;
  }
  return {
    profileIdc: avcC[1] ?? 0,
    profileCompatibility: avcC[2] ?? 0,
    levelIdc: avcC[3] ?? 0,
    lengthSize,
    sps,
    pps,
  };
}

/** NAL units of one length-prefixed packet, as views into it. */
export function* nalUnits(packet: Uint8Array, lengthSize: number): Generator<Uint8Array> {
  let offset = 0;
  while (offset + lengthSize <= packet.length) {
    let length = 0;
    for (let i = 0; i < lengthSize; i += 1) length = length * 256 + (packet[offset + i] ?? 0);
    offset += lengthSize;
    if (length === 0 || offset + length > packet.length) return;
    yield packet.subarray(offset, offset + length);
    offset += length;
  }
}

export function nalType(nal: Uint8Array): number {
  return (nal[0] ?? 0) & 0x1f;
}

/** True when the packet holds an IDR slice: decoding may start here with nothing before it. */
export function isIdrPacket(packet: Uint8Array, lengthSize: number): boolean {
  for (const nal of nalUnits(packet, lengthSize)) {
    const type = nalType(nal);
    if (type === NAL_IDR) return true;
    if (type === NAL_SLICE) return false;
  }
  return false;
}

function lengthPrefixed(nal: Uint8Array, lengthSize: number): Uint8Array {
  const out = new Uint8Array(lengthSize + nal.length);
  let length = nal.length;
  for (let i = lengthSize - 1; i >= 0; i -= 1) {
    out[i] = length & 0xff;
    length = Math.floor(length / 256);
  }
  out.set(nal, lengthSize);
  return out;
}

/**
 * The packet with `sps` and `pps` in front of its pictures: after an access
 * unit delimiter (which must stay first), before everything else. Parameter
 * sets the packet already carries are kept; a repeated identical set is legal.
 */
export function withParameterSets(
  packet: Uint8Array,
  lengthSize: number,
  sps: readonly Uint8Array[],
  pps: readonly Uint8Array[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  let rest = packet;
  const first = nalUnits(packet, lengthSize).next();
  if (!first.done && nalType(first.value) === NAL_AUD) {
    const audEnd = lengthSize + first.value.length;
    parts.push(packet.subarray(0, audEnd));
    rest = packet.subarray(audEnd);
  }
  for (const nal of sps) parts.push(lengthPrefixed(nal, lengthSize));
  for (const nal of pps) parts.push(lengthPrefixed(nal, lengthSize));
  parts.push(rest);
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export interface SpsInfo {
  profileIdc: number;
  levelIdc: number;
  chromaFormatIdc: number;
  bitDepthLuma: number;
  bitDepthChroma: number;
  /** False for interlaced (field / MBAFF) coding. */
  frameMbsOnly: boolean;
  /** Picture size after the SPS frame cropping. */
  width: number;
  height: number;
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

function skipScalingList(r: BitReader, size: number): void {
  let last = 8;
  let next = 8;
  for (let j = 0; j < size; j += 1) {
    if (next !== 0) next = (last + r.se() + 256) % 256;
    last = next === 0 ? last : next;
  }
}

/** Reads the fields the fast cut decides on from an SPS NAL unit (header included, escaped). */
export function readSps(nal: Uint8Array): SpsInfo | null {
  if (nalType(nal) !== NAL_SPS) return null;
  try {
    const rbsp = unescapeRbsp(nal);
    const r = new BitReader(rbsp);
    r.bits(8); // NAL header
    const profileIdc = r.bits(8);
    r.bits(8); // constraint flags
    const levelIdc = r.bits(8);
    r.ue(); // seq_parameter_set_id
    let chromaFormatIdc = 1;
    let bitDepthLuma = 8;
    let bitDepthChroma = 8;
    if (HIGH_PROFILES.has(profileIdc)) {
      chromaFormatIdc = r.ue();
      if (chromaFormatIdc === 3) r.bit(); // separate_colour_plane_flag
      bitDepthLuma = r.ue() + 8;
      bitDepthChroma = r.ue() + 8;
      r.bit(); // qpprime_y_zero_transform_bypass_flag
      if (r.bit()) {
        const lists = chromaFormatIdc === 3 ? 12 : 8;
        for (let i = 0; i < lists; i += 1) {
          if (r.bit()) skipScalingList(r, i < 6 ? 16 : 64);
        }
      }
    }
    r.ue(); // log2_max_frame_num_minus4
    const pocType = r.ue();
    if (pocType === 0) {
      r.ue();
    } else if (pocType === 1) {
      r.bit();
      r.se();
      r.se();
      const cycle = r.ue();
      for (let i = 0; i < cycle; i += 1) r.se();
    }
    r.ue(); // max_num_ref_frames
    r.bit(); // gaps_in_frame_num_value_allowed_flag
    const widthMbs = r.ue() + 1;
    const heightMapUnits = r.ue() + 1;
    const frameMbsOnly = r.bit() === 1;
    if (!frameMbsOnly) r.bit(); // mb_adaptive_frame_field_flag
    r.bit(); // direct_8x8_inference_flag
    let cropLeft = 0;
    let cropRight = 0;
    let cropTop = 0;
    let cropBottom = 0;
    if (r.bit()) {
      cropLeft = r.ue();
      cropRight = r.ue();
      cropTop = r.ue();
      cropBottom = r.ue();
    }
    const subWidth = chromaFormatIdc === 1 || chromaFormatIdc === 2 ? 2 : 1;
    const subHeight = chromaFormatIdc === 1 ? 2 : 1;
    const cropUnitX = chromaFormatIdc === 0 ? 1 : subWidth;
    const cropUnitY = (chromaFormatIdc === 0 ? 1 : subHeight) * (frameMbsOnly ? 1 : 2);
    const width = widthMbs * 16 - cropUnitX * (cropLeft + cropRight);
    const height = heightMapUnits * 16 * (frameMbsOnly ? 1 : 2) - cropUnitY * (cropTop + cropBottom);
    return { profileIdc, levelIdc, chromaFormatIdc, bitDepthLuma, bitDepthChroma, frameMbsOnly, width, height };
  } catch {
    return null;
  }
}
