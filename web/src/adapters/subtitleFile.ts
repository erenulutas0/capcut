/**
 * Reads a user-picked subtitle file into text. The file stays in the browser;
 * only its characters reach the parser.
 *
 * Turkish subtitle files are still commonly saved as Windows-1254 rather than
 * UTF-8. Decoding those as UTF-8 would turn "ğ ş ı" into replacement marks, so
 * UTF-8 is tried strictly first and Windows-1254 is used only when the bytes
 * are not valid UTF-8 — and the caller is told which one was used.
 */

export type SubtitleEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1254';

export type SubtitleFileResult =
  | { ok: true; text: string; encoding: SubtitleEncoding }
  | { ok: false; reason: 'too_large' | 'unreadable' };

/** Real subtitle files are kilobytes; this refuses obvious mistakes (a video). */
export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

export function decodeSubtitleBytes(bytes: Uint8Array): { text: string; encoding: SubtitleEncoding } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1254').decode(bytes), encoding: 'windows-1254' };
  }
}

export async function readSubtitleFile(file: File): Promise<SubtitleFileResult> {
  if (file.size > MAX_SUBTITLE_BYTES) return { ok: false, reason: 'too_large' };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { ok: true, ...decodeSubtitleBytes(bytes) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
