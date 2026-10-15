/**
 * Does an MP4 / MOV index count more frames than the file can hold?
 * (docs/quality/2026-10-15-fuzz.md, finding 1)
 *
 * The index of an MP4 says, per track, how many frames there are (`stsz`)
 * and how long each one lasts (`stts`, in runs: "4 000 000 000 frames of
 * 1/30 s"). A damaged `stts` can claim billions of frames while the file
 * holds 180. The browser's own player shrugs that off, but the media library
 * the page reads the index with (mediabunny) lists every frame the index
 * names, on the page's main thread: the tab froze for over a minute and then
 * ran out of memory (the fuzz run's `stts-bozuk` file, on every card).
 *
 * This check reads the index itself — the `moov` box, a few kilobytes,
 * nothing decoded — and adds the runs up before anything else looks at the
 * frames. `broken` only when the numbers cannot be true: more frames in the
 * timing runs than twice the frames listed (and a thousand more), or more
 * frames listed than the file has bytes. Anything it cannot read is
 * `unknown`, and the caller goes on as before.
 */

/**
 * `truncated`: there is no index, and the file ends inside a box that says it is longer — an MP4
 * whose index was to come at the end, cut short by a download or a copy that stopped (ADR-040's
 * other half: with the index at the start, `sourceIntegrity` says how far the file goes).
 */
export type Mp4IndexVerdict = 'sane' | 'broken' | 'truncated' | 'unknown';

/** The largest `moov` this check reads (a two-hour phone video's index is a few megabytes). */
export const MAX_INDEX_BYTES = 64 * 1024 * 1024;
/** How many top-level boxes are walked before giving up on finding `moov`. */
const MAX_TOP_LEVEL_BOXES = 4096;

interface Box {
  type: string;
  /** Where the box's content starts (after its header), relative to the buffer or the file. */
  contentAt: number;
  /** Where the box ends. */
  end: number;
}

function typeAt(view: DataView, at: number): string {
  let text = '';
  for (let i = 0; i < 4; i += 1) text += String.fromCharCode(view.getUint8(at + i));
  return text;
}

/** The boxes inside `[start, end)` of `view`; stops at the first header that does not fit. */
function childBoxes(view: DataView, start: number, end: number): Box[] {
  const found: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = typeAt(view, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    found.push({ type, contentAt: at + header, end: at + size });
    at += size;
  }
  return found;
}

const child = (view: DataView, box: Box, type: string): Box | undefined =>
  childBoxes(view, box.contentAt, box.end).find((inner) => inner.type === type);

/** Adds up the run counts of a `stts` or `ctts` box (full box: version + flags, entry count, then 8-byte entries). */
function runTotal(view: DataView, box: Box): number | null {
  if (box.contentAt + 8 > box.end) return null;
  const entries = view.getUint32(box.contentAt + 4);
  // A count that does not fit the box is itself a broken index; read what is there.
  const fitting = Math.min(entries, Math.floor((box.end - box.contentAt - 8) / 8));
  let total = 0;
  for (let i = 0; i < fitting; i += 1) total += view.getUint32(box.contentAt + 8 + i * 8);
  return total;
}

/** The number of frames `stsz` (or the compact `stz2`) lists. */
function listedFrames(view: DataView, stbl: Box): number | null {
  const stsz = child(view, stbl, 'stsz');
  if (stsz && stsz.contentAt + 12 <= stsz.end) return view.getUint32(stsz.contentAt + 8);
  const stz2 = child(view, stbl, 'stz2');
  if (stz2 && stz2.contentAt + 12 <= stz2.end) return view.getUint32(stz2.contentAt + 8);
  return null;
}

/**
 * The verdict for a whole `moov` box's bytes (`moov` header included or not: both are accepted),
 * given the size of the file it came from.
 */
export function judgeMoov(moov: Uint8Array, fileBytes: number): Mp4IndexVerdict {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  let top: Box = { type: 'moov', contentAt: 0, end: moov.byteLength };
  if (moov.byteLength >= 8 && typeAt(view, 4) === 'moov') {
    const [own] = childBoxes(view, 0, moov.byteLength);
    if (own) top = own;
  }
  let checked = 0;
  for (const trak of childBoxes(view, top.contentAt, top.end).filter((box) => box.type === 'trak')) {
    const mdia = child(view, trak, 'mdia');
    const minf = mdia && child(view, mdia, 'minf');
    const stbl = minf && child(view, minf, 'stbl');
    if (!stbl) continue;
    const frames = listedFrames(view, stbl);
    if (frames === null) continue;
    checked += 1;
    if (frames > fileBytes) return 'broken';
    const bound = 2 * frames + 1000;
    for (const type of ['stts', 'ctts']) {
      const box = child(view, stbl, type);
      const total = box ? runTotal(view, box) : null;
      if (total !== null && total > bound) return 'broken';
    }
  }
  return checked > 0 ? 'sane' : 'unknown';
}

/** Finds the top-level `moov` of an MP4 / MOV file and judges it; never throws. */
export async function checkMp4Index(file: Blob): Promise<Mp4IndexVerdict> {
  try {
    let at = 0;
    for (let count = 0; count < MAX_TOP_LEVEL_BOXES && at + 8 <= file.size; count += 1) {
      const head = new DataView(await file.slice(at, at + 16).arrayBuffer());
      let size = head.getUint32(0);
      const type = typeAt(head, 4);
      if (size === 1) {
        if (head.byteLength < 16) return 'unknown';
        size = Number(head.getBigUint64(8));
      } else if (size === 0) {
        size = file.size - at;
      }
      if (size < 8) return 'unknown';
      if (type === 'moov') {
        if (size > MAX_INDEX_BYTES || at + size > file.size) return 'unknown';
        return judgeMoov(new Uint8Array(await file.slice(at, at + size).arrayBuffer()), file.size);
      }
      // The media data runs past the end of the file and no index came before it: the end is missing.
      if (type === 'mdat' && at + size > file.size) return 'truncated';
      at += size;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
