/**
 * Reads a GIF's structure back (ADR-046): the page checks every GIF it made
 * before it says "Kaydedildi" — a file that is not a whole GIF is never
 * announced as one — and the tests read the saved file with the same rules.
 * Nothing is decoded: blocks are walked and counted.
 */

export interface GifInspection {
  width: number;
  height: number;
  frames: number;
  /** The NETSCAPE2.0 block's loop count: 0 = for ever; null = no loop block (plays once). */
  loops: number | null;
  /** Sum of the frames' delays, in hundredths of a second. */
  durationCs: number;
  /** Every frame's delay, in hundredths. */
  delaysCs: number[];
  globalColors: number;
}

export type GifInspectResult = { ok: true; gif: GifInspection } | { ok: false; reason: string };

export function inspectGif(bytes: Uint8Array): GifInspectResult {
  const fail = (reason: string): GifInspectResult => ({ ok: false, reason });
  if (bytes.length < 14) return fail('too_short');
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF89a' && signature !== 'GIF87a') return fail('not_a_gif');
  const u16 = (at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
  const width = u16(6);
  const height = u16(8);
  const packed = bytes[10] ?? 0;
  let at = 13;
  let globalColors = 0;
  if (packed & 0x80) {
    globalColors = 2 << (packed & 7);
    at += globalColors * 3;
  }
  let frames = 0;
  let loops: number | null = null;
  let pendingDelay = 0;
  const delaysCs: number[] = [];
  /** Skips data sub-blocks; returns the position after the terminator, or -1 when the file ends first. */
  const skipBlocks = (from: number): number => {
    let p = from;
    while (p < bytes.length) {
      const size = bytes[p] ?? 0;
      if (size === 0) return p + 1;
      p += size + 1;
    }
    return -1;
  };
  while (at < bytes.length) {
    const introducer = bytes[at];
    if (introducer === 0x3b) {
      if (frames === 0) return fail('no_frames');
      const durationCs = delaysCs.reduce((sum, delay) => sum + delay, 0);
      return { ok: true, gif: { width, height, frames, loops, durationCs, delaysCs, globalColors } };
    }
    if (introducer === 0x21) {
      const label = bytes[at + 1];
      if (label === 0xf9) pendingDelay = u16(at + 4);
      if (label === 0xff && String.fromCharCode(...bytes.subarray(at + 3, at + 14)) === 'NETSCAPE2.0') loops = u16(at + 16);
      const next = skipBlocks(at + 2);
      if (next < 0) return fail('truncated');
      at = next;
      continue;
    }
    if (introducer === 0x2c) {
      const local = bytes[at + 9] ?? 0;
      let p = at + 10;
      if (local & 0x80) p += (2 << (local & 7)) * 3;
      p += 1; // LZW minimum code size
      const next = skipBlocks(p);
      if (next < 0) return fail('truncated');
      frames += 1;
      delaysCs.push(pendingDelay);
      pendingDelay = 0;
      at = next;
      continue;
    }
    return fail('bad_block');
  }
  return fail('truncated');
}
