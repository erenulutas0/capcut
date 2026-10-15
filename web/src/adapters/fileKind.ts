/**
 * What kind of file is this, from its first bytes? (docs/quality/2026-10-15-fuzz.md)
 *
 * Asked only after the browser has refused to open a picked file, so that the
 * refusal can say the true thing: an empty file, a picture, a sound without
 * a picture, a kind of video file this app does not open (AVI, TS, MKV), or
 * bytes that are not a video at all. Before this every one of them heard
 * "the file may be damaged or this browser does not play this format" — a
 * valid AVI is not damaged, and an empty file is not a browser problem.
 *
 * Only the signature at the start of the file is read (a few bytes; nothing
 * is decoded). The answer is a hint for the sentence, never a reason to open
 * or to refuse a file the browser itself accepted.
 */

export type FileKind =
  /** Zero bytes. */
  | 'empty'
  /** MP4 / MOV / 3GP / M4A: the containers this app opens. */
  | 'isobmff'
  /** WebM: a container this browser plays (whether it plays the codec inside is another question). */
  | 'webm'
  /** MKV. */
  | 'matroska'
  | 'avi'
  /** MPEG transport stream (.ts, .mts, .m2ts). */
  | 'mpeg_ts'
  /** MPEG program stream (.mpg, .vob). */
  | 'mpeg_ps'
  /** Flash video (.flv). */
  | 'flv'
  /** Windows Media (.wmv, .asf). */
  | 'asf'
  /** A still or animated picture: PNG, JPEG, GIF, WebP, HEIC / AVIF. */
  | 'image'
  /** A sound file: MP3, WAV, FLAC, Ogg. */
  | 'audio'
  /** Nothing this list knows. */
  | 'unknown';

/** How many bytes `fileKind` needs (two transport-stream packets and a bit). */
export const FILE_KIND_HEAD_BYTES = 512;

const ascii = (bytes: Uint8Array, at: number, length: number): string => {
  let text = '';
  for (let i = at; i < at + length && i < bytes.length; i += 1) text += String.fromCharCode(bytes[i] ?? 0);
  return text;
};

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((value, index) => bytes[at + index] === value);

/** ISO BMFF top-level boxes a file may start with. */
const BMFF_FIRST_BOXES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid']);
/** `ftyp` brands of still pictures (HEIF / AVIF), not videos. */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);

/**
 * The kind of file, from `head` (its first bytes, at least `FILE_KIND_HEAD_BYTES` when the file
 * is that long) and its full size.
 */
export function fileKind(head: Uint8Array, size: number): FileKind {
  if (size === 0) return 'empty';
  if (BMFF_FIRST_BOXES.has(ascii(head, 4, 4))) {
    if (ascii(head, 4, 4) === 'ftyp' && IMAGE_BRANDS.has(ascii(head, 8, 4))) return 'image';
    return 'isobmff';
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    // The EBML header names the document type near the start: "webm" or "matroska".
    return ascii(head, 0, 64).includes('webm') ? 'webm' : 'matroska';
  }
  if (ascii(head, 0, 4) === 'RIFF') {
    const form = ascii(head, 8, 4);
    if (form === 'AVI ') return 'avi';
    if (form === 'WAVE') return 'audio';
    if (form === 'WEBP') return 'image';
    return 'unknown';
  }
  // A transport stream is 188-byte packets, each starting with 0x47 (some cameras put a 4-byte time code before each: 192).
  const packetAt = (offset: number, length: number) => head[offset] === 0x47 && head[offset + length] === 0x47;
  if (packetAt(0, 188) || packetAt(4, 192)) return 'mpeg_ts';
  if (startsWith(head, [0x00, 0x00, 0x01, 0xba])) return 'mpeg_ps';
  if (ascii(head, 0, 3) === 'FLV') return 'flv';
  if (startsWith(head, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return 'asf';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image';
  if (ascii(head, 0, 4) === 'GIF8') return 'image';
  if (ascii(head, 0, 2) === 'BM' && head.length > 14 && size > 26) return 'image';
  if (ascii(head, 0, 3) === 'ID3' || ascii(head, 0, 4) === 'fLaC' || ascii(head, 0, 4) === 'OggS') return 'audio';
  // An MP3 frame header: eleven sync bits.
  if (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0 && ((head[1] ?? 0) & 0x06) !== 0) return 'audio';
  return 'unknown';
}

/** Reads the start of the user's file (never more than `FILE_KIND_HEAD_BYTES`) and says its kind; `unknown` when it cannot be read. */
export async function readFileKind(file: Blob): Promise<FileKind> {
  if (file.size === 0) return 'empty';
  try {
    const head = new Uint8Array(await file.slice(0, FILE_KIND_HEAD_BYTES).arrayBuffer());
    return fileKind(head, file.size);
  } catch {
    return 'unknown';
  }
}

/** The name a refusal uses for a kind of video file this app does not open; `null` for every other kind. */
export function foreignVideoName(kind: FileKind): string | null {
  switch (kind) {
    case 'avi':
      return 'AVI';
    case 'mpeg_ts':
      return 'TS';
    case 'mpeg_ps':
      return 'MPG';
    case 'flv':
      return 'FLV';
    case 'asf':
      return 'WMV';
    case 'matroska':
      return 'MKV';
    default:
      return null;
  }
}
