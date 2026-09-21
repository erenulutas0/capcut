/**
 * Corrects an H.264 stream whose SPS understates how far frames are reordered.
 *
 * Why this exists (ADR-014 §3): a real GoPro (Ambarella) file declares
 * `bitstream_restriction_flag = 1` with `max_num_reorder_frames = 1`, but its
 * GOPs start with an IDR followed by three B-frames that are *shown before* it,
 * which needs a reorder depth of 2. FFmpeg's H.264 decoder — the software path
 * of Chromium, Chrome and Edge — trusts the declared value when the flag is
 * set, so once per GOP it emits a frame "out of order" and drops it. WebCodecs
 * reports nothing; mediabunny then gives each delivered picture the next
 * pending chunk timestamp, so the timestamps stay perfect while the pictures
 * slide further behind at every GOP. Hardware decoders size their reorder
 * window differently and were not affected.
 *
 * The container already knows the truth: every packet's decode and
 * presentation order. `reorderDepth` measures it, and `raiseAvcReorderDepth`
 * rewrites the SPS inside the avcC record so the decoder waits long enough.
 * Only the two reorder fields change; nothing is re-encoded.
 */

/** H.264 caps the DPB at 16 frames; no honest stream reorders deeper. */
const MAX_DPB_FRAMES = 16;

/**
 * How many frames a B-frame pattern needs to be reordered by: a frame's count
 * is the number of frames that precede it in decode order and follow it in
 * presentation order (the H.264 definition of `max_num_reorder_frames`),
 * measured from container timestamps given in decode order.
 *
 * A B-frame pattern repeats in every group, so the result is the deepest count
 * reached by at least `minOccurrences` frames. A single out-of-place timestamp
 * — seen at the join of a concatenated synthetic file (matrix M06) — is a mux
 * glitch, not reordering, and must not trigger a rewrite.
 */
export function reorderDepth(
  presentationTimesInDecodeOrder: readonly number[],
  minOccurrences = 3,
): number {
  const counts: number[] = [];
  for (let i = 0; i < presentationTimesInDecodeOrder.length; i += 1) {
    const t = presentationTimesInDecodeOrder[i] ?? 0;
    let later = 0;
    // A frame can only be overtaken by frames within the DPB size before it.
    const from = Math.max(0, i - MAX_DPB_FRAMES * 2);
    for (let j = from; j < i; j += 1) {
      if ((presentationTimesInDecodeOrder[j] ?? 0) > t) later += 1;
    }
    counts.push(later);
  }
  counts.sort((a, b) => b - a);
  return Math.min(counts[minOccurrences - 1] ?? 0, MAX_DPB_FRAMES);
}

/* ----------------------------------------------------------- bit utilities */

function unescapeRbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of nal) {
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

function escapeRbsp(rbsp: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros >= 2 && byte <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

class BitReader {
  pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  bit(): number {
    const byte = this.bytes[this.pos >> 3];
    if (byte === undefined) throw new RangeError('sps: out of data');
    const value = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos += 1;
    return value;
  }

  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) value = value * 2 + this.bit();
    return value;
  }

  ue(): number {
    let leadingZeros = 0;
    while (this.bit() === 0) {
      leadingZeros += 1;
      if (leadingZeros > 31) throw new RangeError('sps: bad exp-golomb');
    }
    return 2 ** leadingZeros - 1 + this.bits(leadingZeros);
  }

  se(): number {
    const code = this.ue();
    return code % 2 === 0 ? -(code / 2) : (code + 1) / 2;
  }
}

class BitWriter {
  private readonly out: number[] = [];
  private current = 0;
  private filled = 0;

  bit(value: number): void {
    this.current = (this.current << 1) | (value & 1);
    this.filled += 1;
    if (this.filled === 8) {
      this.out.push(this.current);
      this.current = 0;
      this.filled = 0;
    }
  }

  ue(value: number): void {
    const code = value + 1;
    const length = Math.floor(Math.log2(code));
    for (let i = 0; i < length; i += 1) this.bit(0);
    for (let i = length; i >= 0; i -= 1) this.bit(Math.floor(code / 2 ** i) % 2);
  }

  /** rbsp_trailing_bits: a stop bit, then zeros to the byte boundary. */
  finish(): Uint8Array {
    this.bit(1);
    while (this.filled !== 0) this.bit(0);
    return Uint8Array.from(this.out);
  }
}

/* --------------------------------------------------------------- SPS parse */

export interface SpsReorderInfo {
  /** Bit offset (in the unescaped NAL) where `max_num_reorder_frames` starts. */
  reorderBitOffset: number;
  maxNumReorderFrames: number;
  maxDecFrameBuffering: number;
}

function skipHrd(r: BitReader): void {
  const cpbCount = r.ue() + 1;
  r.bits(4); // bit_rate_scale
  r.bits(4); // cpb_size_scale
  for (let i = 0; i < cpbCount; i += 1) {
    r.ue(); // bit_rate_value_minus1
    r.ue(); // cpb_size_value_minus1
    r.bit(); // cbr_flag
  }
  r.bits(5 + 5 + 5 + 5); // delay / length fields
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/**
 * Walks an SPS (unescaped, NAL header included) to its VUI bitstream
 * restriction. Returns null when the SPS does not declare one — FFmpeg then
 * sizes the reorder buffer itself and mediabunny patches that case already.
 */
export function readSpsReorder(rbsp: Uint8Array): SpsReorderInfo | null {
  const r = new BitReader(rbsp);
  r.bits(8); // NAL header
  if (((rbsp[0] ?? 0) & 0x1f) !== 7) return null;
  const profileIdc = r.bits(8);
  r.bits(16); // constraint flags + level_idc
  r.ue(); // seq_parameter_set_id
  if (HIGH_PROFILES.has(profileIdc)) {
    const chromaFormatIdc = r.ue();
    if (chromaFormatIdc === 3) r.bit();
    r.ue(); // bit_depth_luma_minus8
    r.ue(); // bit_depth_chroma_minus8
    r.bit(); // qpprime_y_zero_transform_bypass_flag
    if (r.bit()) {
      const lists = chromaFormatIdc === 3 ? 12 : 8;
      for (let i = 0; i < lists; i += 1) {
        if (!r.bit()) continue;
        const size = i < 6 ? 16 : 64;
        let last = 8;
        let next = 8;
        for (let j = 0; j < size; j += 1) {
          if (next !== 0) next = (last + r.se() + 256) % 256;
          last = next === 0 ? last : next;
        }
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
  r.ue(); // pic_width_in_mbs_minus1
  r.ue(); // pic_height_in_map_units_minus1
  if (!r.bit()) r.bit(); // frame_mbs_only_flag, mb_adaptive_frame_field_flag
  r.bit(); // direct_8x8_inference_flag
  if (r.bit()) {
    r.ue();
    r.ue();
    r.ue();
    r.ue();
  }
  if (!r.bit()) return null; // vui_parameters_present_flag
  if (r.bit() && r.bits(8) === 255) r.bits(32); // aspect ratio (+ Extended_SAR)
  if (r.bit()) r.bit(); // overscan
  if (r.bit()) {
    r.bits(4); // video_format + video_full_range_flag
    if (r.bit()) r.bits(24); // colour description
  }
  if (r.bit()) {
    r.ue();
    r.ue();
  }
  if (r.bit()) r.bits(32 + 32 + 1); // timing info
  const nalHrd = r.bit();
  if (nalHrd) skipHrd(r);
  const vclHrd = r.bit();
  if (vclHrd) skipHrd(r);
  if (nalHrd || vclHrd) r.bit(); // low_delay_hrd_flag
  r.bit(); // pic_struct_present_flag
  if (!r.bit()) return null; // bitstream_restriction_flag
  r.bit(); // motion_vectors_over_pic_boundaries_flag
  r.ue(); // max_bytes_per_pic_denom
  r.ue(); // max_bits_per_mb_denom
  r.ue(); // log2_max_mv_length_horizontal
  r.ue(); // log2_max_mv_length_vertical
  const reorderBitOffset = r.pos;
  const maxNumReorderFrames = r.ue();
  const maxDecFrameBuffering = r.ue();
  return { reorderBitOffset, maxNumReorderFrames, maxDecFrameBuffering };
}

/** Rewrites the two reorder fields; they are the last syntax elements of an SPS. */
function rewriteSpsReorder(rbsp: Uint8Array, info: SpsReorderInfo, reorder: number): Uint8Array {
  const r = new BitReader(rbsp);
  const w = new BitWriter();
  for (let i = 0; i < info.reorderBitOffset; i += 1) w.bit(r.bit());
  w.ue(reorder);
  w.ue(Math.max(info.maxDecFrameBuffering, reorder));
  return w.finish();
}

/* -------------------------------------------------------------- avcC record */

/**
 * Returns a copy of the avcC record whose SPS declare at least
 * `requiredReorder` reorder frames, or null when nothing needs changing (or
 * the record cannot be read — the stream is then decoded exactly as before).
 */
export function raiseAvcReorderDepth(avcC: Uint8Array, requiredReorder: number): Uint8Array | null {
  if (avcC.length < 7 || avcC[0] !== 1) return null;
  const target = Math.min(requiredReorder, MAX_DPB_FRAMES);
  const spsCount = (avcC[5] ?? 0) & 0x1f;
  const parts: Uint8Array[] = [avcC.subarray(0, 6)];
  let offset = 6;
  let changed = false;

  try {
    for (let i = 0; i < spsCount; i += 1) {
      const length = ((avcC[offset] ?? 0) << 8) | (avcC[offset + 1] ?? 0);
      const nal = avcC.subarray(offset + 2, offset + 2 + length);
      if (nal.length !== length) return null;
      offset += 2 + length;

      const rbsp = unescapeRbsp(nal);
      const info = readSpsReorder(rbsp);
      let out = nal;
      if (info && info.maxNumReorderFrames < target) {
        out = escapeRbsp(rewriteSpsReorder(rbsp, info, target));
        changed = true;
      }
      parts.push(Uint8Array.of(out.length >> 8, out.length & 0xff), out);
    }
  } catch {
    return null;
  }

  if (!changed) return null;
  parts.push(avcC.subarray(offset)); // PPS and any extension, untouched
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

/**
 * True when a packet carries its own SPS that understates `requiredReorder`.
 *
 * The avcC fix alone does not survive that: measured in Chromium, FFmpeg
 * re-reads an in-band SPS at every keyframe and drops frames again. Packets
 * are length-prefixed (`lengthSize` from the avcC record).
 */
export function inBandSpsUnderstates(
  packet: Uint8Array,
  lengthSize: number,
  requiredReorder: number,
): boolean {
  let offset = 0;
  while (offset + lengthSize <= packet.length) {
    let length = 0;
    for (let i = 0; i < lengthSize; i += 1) length = length * 256 + (packet[offset + i] ?? 0);
    offset += lengthSize;
    const nal = packet.subarray(offset, offset + length);
    offset += length;
    if (nal.length === 0 || ((nal[0] ?? 0) & 0x1f) !== 7) continue;
    try {
      const info = readSpsReorder(unescapeRbsp(nal));
      if (info && info.maxNumReorderFrames < Math.min(requiredReorder, MAX_DPB_FRAMES)) return true;
    } catch {
      // An SPS we cannot read is left to the decoder, as before.
    }
  }
  return false;
}

/** NAL length prefix size declared by an avcC record (1, 2 or 4 bytes). */
export function avcLengthSize(avcC: Uint8Array): number {
  return ((avcC[4] ?? 3) & 0b11) + 1;
}
