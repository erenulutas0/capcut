/**
 * Words a child or a first-time user cannot be expected to know.
 *
 * Two lists, reported separately:
 * - `STRONG`: engineering vocabulary. One of these on the default path of a
 *   task (not behind "Ayarlar" or "Ayrıntılar") is a finding.
 * - `MILD`: file types and terms many people have seen but few could
 *   explain. Counted, not judged.
 *
 * The lists are small on purpose and are meant to be argued with: adding a
 * word here changes a number in the report, nothing else.
 */

export interface JargonTerm {
  term: string;
  pattern: RegExp;
}

const word = (source: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');

export const STRONG: readonly JargonTerm[] = [
  { term: 'codec / kodek', pattern: word('codec\\p{L}*|kodek\\p{L}*') },
  { term: 'kodlama / encode', pattern: word('kodla\\p{L}*|kodlan\\p{L}*|encode\\p{L}*|encoder') },
  { term: 'bit hızı / bitrate', pattern: word('bit hız\\p{L}*|bitrate') },
  { term: 'fps / kare hızı', pattern: word('fps|kare hız\\p{L}*') },
  { term: 'H.264 / H.265 / HEVC / AVC', pattern: word('h\\.?26[45]|hevc|avc') },
  { term: 'AAC / Opus / VP9', pattern: word('aac|opus|vp9') },
  { term: 'çözünürlük', pattern: word('çözünürlü\\p{L}*') },
  { term: '720p / 1080p', pattern: word('\\d{3,4}p') },
  { term: 'HDR / SDR', pattern: word('hdr|sdr') },
  { term: 'WebGPU / WebGL / WASM / GPU', pattern: word('webgpu|webgl|wasm|webassembly|gpu') },
  { term: 'piksel', pattern: word('piksel\\p{L}*') },
  { term: 'iz (ses izi, video izi)', pattern: word('(?:ses|video) iz\\p{L}*') },
];

export const MILD: readonly JargonTerm[] = [
  { term: 'MP4 / MOV / WebM', pattern: word('mp4\\p{L}*|mov|webm') },
  { term: 'M4A / MP3 / WAV', pattern: word('m4a\\p{L}*|mp3|wav') },
  { term: 'SRT / VTT', pattern: word('srt|vtt') },
  { term: 'model', pattern: word('model\\p{L}*') },
  { term: '9:16 / 1080 × 1920', pattern: word('9:16|\\d{3,4} ?[×x] ?\\d{3,4}') },
  { term: 'MB / GB', pattern: word('\\d+(?:,\\d+)? ?(?:kb|mb|gb)') },
];

/**
 * The same two lists for the English screens (ADR-048): the same ideas, in the words an English
 * screen would use for them.
 */
export const STRONG_EN: readonly JargonTerm[] = [
  { term: 'codec', pattern: word('codecs?') },
  { term: 'encode / encoder / re-encode', pattern: word('(?:re-?)?encod\\p{L}*') },
  { term: 'bitrate / bit rate', pattern: word('bit ?rates?') },
  { term: 'fps / frame rate', pattern: word('fps|frame rates?') },
  { term: 'H.264 / H.265 / HEVC / AVC', pattern: word('h\\.?26[45]|hevc|avc') },
  { term: 'AAC / Opus / VP9', pattern: word('aac|opus|vp9') },
  { term: 'resolution', pattern: word('resolutions?') },
  { term: '720p / 1080p', pattern: word('\\d{3,4}p') },
  { term: 'HDR / SDR', pattern: word('hdr|sdr') },
  { term: 'WebGPU / WebGL / WASM / GPU', pattern: word('webgpu|webgl|wasm|webassembly|gpu') },
  { term: 'pixel', pattern: word('pixels?') },
  { term: 'track (audio track, video track)', pattern: word('(?:audio|video) tracks?') },
];

export const MILD_EN: readonly JargonTerm[] = [
  { term: 'MP4 / MOV / WebM', pattern: word('mp4|mov|webm') },
  { term: 'M4A / MP3 / WAV', pattern: word('m4a|mp3|wav') },
  { term: 'SRT / VTT', pattern: word('srt|vtt') },
  { term: 'model', pattern: word('models?') },
  { term: '9:16 / 1080 × 1920', pattern: word('9:16|\\d{3,4} ?[×x] ?\\d{3,4}') },
  { term: 'MB / GB', pattern: word('\\d+(?:\\.\\d+)? ?(?:kb|mb|gb)') },
];

export interface JargonHit {
  term: string;
  /** The sentence (or line) it was found in, shortened. */
  context: string;
}

function hits(text: string, terms: readonly JargonTerm[]): JargonHit[] {
  const found: JargonHit[] = [];
  const lines = text
    .split(/\n+|(?<=[.!?…])\s+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    for (const { term, pattern } of terms) {
      if (pattern.test(line)) found.push({ term, context: line.length > 140 ? `${line.slice(0, 137)}…` : line });
    }
  }
  return found;
}

export function strongJargon(text: string, lang: 'tr' | 'en' = 'tr'): JargonHit[] {
  return hits(text, lang === 'en' ? STRONG_EN : STRONG);
}

export function mildJargon(text: string, lang: 'tr' | 'en' = 'tr'): JargonHit[] {
  return hits(text, lang === 'en' ? MILD_EN : MILD);
}

/** Words as a reader counts them: runs of letters or digits. */
export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:[’'][\p{L}]+)?/gu) ?? []).length;
}
