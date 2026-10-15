/**
 * Browser media adapter: local file -> real metadata + a session-scoped handle.
 *
 * Rules this file exists to enforce:
 * - the source file is never read into app state, never base64'd, never uploaded;
 * - an object URL is a session handle, not an asset address (doc 11);
 * - every handle has one owner and one `release()`.
 */

import { MIN_CLIP_DURATION_US, secondsToUs, type Micros } from '../domain/time';
import type { ProbeResult } from '../domain/mediaEngine';
import { foreignVideoName, readFileKind } from './fileKind';
import { checkMp4Index } from './mp4Index';
import { sourceIntegrity, type SourceIntegrity } from './sourceIntegrity';

export type ProbeFailure =
  | 'unreadable'
  | 'unsupported_preview'
  | 'unknown_duration'
  | 'timeout'
  | 'file_too_large'
  | 'total_too_large'
  | 'source_too_long'
  | 'music_too_large'
  | 'music_too_long'
  /** ADR-040: the file's index lists more than the file holds (a download or copy that stopped half way). */
  | 'incomplete'
  | 'music_incomplete'
  // The fuzz run (docs/quality/2026-10-15-fuzz.md): what a refused file really is, instead of
  // "it may be damaged or this browser does not play it" for all of them.
  /** Zero bytes. */
  | 'empty_file'
  /** An MP4 / MOV whose index cannot be true (`mp4Index.ts`); reading it froze the tab before. */
  | 'damaged'
  /** An MP4 / MOV cut short before its index (which was to come at the end): nothing of it can be opened. */
  | 'cut_short'
  /** A picture (PNG, JPEG, GIF…), whatever its name says. */
  | 'not_video_picture'
  /** A sound without a picture, picked as the video. */
  | 'sound_only'
  /** A kind of video file this app does not open (AVI, TS, MKV the browser does not play…); see `typeName`. */
  | 'foreign_type'
  /** Bytes that are no kind of media file this app knows. */
  | 'not_video'
  /** A video shorter than the shortest kesit (0.1 s, e.g. a single frame): no card can make anything of it. */
  | 'too_short';

/** With `incomplete`: the length the file declares and how far it really goes. */
export interface IncompleteExtent {
  declaredUs: Micros;
  readableUs: Micros;
}

export interface MediaHandle extends ProbeResult {
  kind: 'video' | 'audio';
  fileName: string;
  objectUrl: string;
  /**
   * The user's own `File`. Kept as a reference, never read into memory here:
   * the export worker streams from it through `BlobSource`.
   */
  file: File;
  release(): void;
}

/**
 * Extra, actionable context for a refusal. `hevc_decoder_missing`: the file is
 * HEVC (H.265) and this browser reports no decoder for it (ADR-022 measured
 * Edge and Playwright Chromium on Windows without one). Only a hint: whether
 * installing a system decoder helps is not something the page can know.
 */
export type ProbeHint = 'hevc_decoder_missing';

export type ProbeOutcome =
  | { ok: true; handle: MediaHandle }
  | {
      ok: false;
      reason: ProbeFailure;
      hint?: ProbeHint;
      extent?: IncompleteExtent;
      /** With `foreign_type`: the short name of the kind of file ("AVI", "TS", "MKV"). */
      typeName?: string;
    };

const PROBE_TIMEOUT_MS = 15_000;

function createElement(kind: 'video' | 'audio'): HTMLMediaElement {
  const element = kind === 'video' ? document.createElement('video') : document.createElement('audio');
  element.preload = 'metadata';
  element.muted = true;
  // Never let a probe element autoplay or attach to the document.
  element.setAttribute('playsinline', '');
  return element;
}

interface Limits {
  maxBytes: number;
  maxDurationUs: Micros;
}

async function probeFile(
  file: File,
  kind: 'video' | 'audio',
  limits: Limits,
): Promise<ProbeOutcome> {
  if (file.size > limits.maxBytes) {
    return { ok: false, reason: kind === 'audio' ? 'music_too_large' : 'file_too_large' };
  }
  // Nothing to play: said at once, without handing the browser an empty file (which also logged a console error).
  if (file.size === 0) return { ok: false, reason: 'empty_file' };

  const objectUrl = URL.createObjectURL(file);
  const element = createElement(kind);

  const cleanupProbe = () => {
    element.removeAttribute('src');
    element.load();
  };

  const result = await new Promise<ProbeOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ProbeOutcome) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      element.onloadedmetadata = null;
      element.onerror = null;
      resolve(outcome);
    };

    const timer = window.setTimeout(() => finish({ ok: false, reason: 'timeout' }), PROBE_TIMEOUT_MS);

    element.onerror = () => finish({ ok: false, reason: 'unsupported_preview' });
    element.onloadedmetadata = () => {
      const seconds = element.duration;
      if (!Number.isFinite(seconds) || seconds <= 0) {
        finish({ ok: false, reason: 'unknown_duration' });
        return;
      }
      const durationUs = secondsToUs(seconds);
      if (durationUs > limits.maxDurationUs) {
        finish({ ok: false, reason: kind === 'audio' ? 'music_too_long' : 'source_too_long' });
        return;
      }
      // Said when it is picked, not as "this browser cannot export" at the download (the fuzz run's one-frame video).
      if (kind === 'video' && durationUs < MIN_CLIP_DURATION_US) {
        finish({ ok: false, reason: 'too_short' });
        return;
      }

      const video = kind === 'video' ? (element as HTMLVideoElement) : null;
      if (video && (video.videoWidth === 0 || video.videoHeight === 0)) {
        finish({ ok: false, reason: 'unsupported_preview' });
        return;
      }

      finish({
        ok: true,
        handle: {
          kind,
          fileName: file.name,
          objectUrl,
          file,
          durationUs,
          displayWidth: video?.videoWidth,
          displayHeight: video?.videoHeight,
          hasAudio: detectHasAudioFromElement(element),
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          release: () => URL.revokeObjectURL(objectUrl),
        },
      });
    };

    element.src = objectUrl;
    element.load();
  });

  cleanupProbe();
  if (!result.ok) {
    URL.revokeObjectURL(objectUrl);
    if (kind === 'video' && result.reason === 'unsupported_preview') return explainRefusal(file);
    return result;
  }

  // Before anything reads the index frame by frame: can its numbers be true? A damaged timing
  // table that claims billions of frames froze the tab (the fuzz run's `stts-bozuk`).
  if ((await checkMp4Index(file)) === 'broken') {
    URL.revokeObjectURL(objectUrl);
    return { ok: false, reason: 'damaged' };
  }

  // One look at the container: is everything its index lists really in the
  // file (ADR-040), and — where the media element could not say — has it sound?
  const container = await inspectContainer(file);
  if (container.integrity.kind === 'incomplete') {
    URL.revokeObjectURL(objectUrl);
    return {
      ok: false,
      reason: kind === 'audio' ? 'music_incomplete' : 'incomplete',
      extent: { declaredUs: container.integrity.declaredUs, readableUs: container.integrity.readableUs },
    };
  }
  if (result.handle.hasAudio === undefined && container.hasAudio !== undefined) {
    result.handle.hasAudio = container.hasAudio;
  }
  return result;
}

/**
 * Media-element heuristics, used only as a fallback.
 *
 * `webkitAudioDecodedByteCount` deliberately only proves PRESENCE: at
 * `loadedmetadata` nothing has been decoded yet, so a 0 there means "not yet",
 * not "no audio". Reading it as absence made the editor report silent sources
 * for ordinary files — and, worse, dropped their audio from the export.
 */
function detectHasAudioFromElement(element: HTMLMediaElement): boolean | undefined {
  const candidate = element as HTMLMediaElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
  };
  if (typeof candidate.mozHasAudio === 'boolean') return candidate.mozHasAudio;
  if (candidate.audioTracks && typeof candidate.audioTracks.length === 'number') {
    return candidate.audioTracks.length > 0;
  }
  if (
    typeof candidate.webkitAudioDecodedByteCount === 'number' &&
    candidate.webkitAudioDecodedByteCount > 0
  ) {
    return true;
  }
  return undefined;
}

/**
 * What the demuxer says about the file, read from the container's index (no
 * frame is decoded):
 *
 * - `hasAudio`: the authoritative answer, from the track list instead of a
 *   guess from the media element; `undefined` only when the file cannot be
 *   parsed here at all.
 * - `integrity`: whether the bytes of everything the index lists are in the
 *   file (`sourceIntegrity`, ADR-040). `unknown` is never a refusal.
 */
async function inspectContainer(file: File): Promise<{ hasAudio: boolean | undefined; integrity: SourceIntegrity }> {
  let input: { dispose(): void } | null = null;
  try {
    const { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, IsobmffInputFormat } = await import('mediabunny');
    const opened = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    input = opened;
    let hasAudio: boolean | undefined;
    try {
      hasAudio = (await opened.getPrimaryAudioTrack()) !== null;
    } catch {
      hasAudio = undefined;
    }
    // Test hook only (`window.__clipSkipImportIntegrity`): lets a test hand the export a file that is not
    // all there, to prove the export's own refusal (ADR-040). The app never sets it.
    const skip = (globalThis as { __clipSkipImportIntegrity?: unknown }).__clipSkipImportIntegrity === true;
    const integrity: SourceIntegrity = skip
      ? { kind: 'unknown' }
      : await sourceIntegrity(opened, {
          EncodedPacketSink,
          isIndexed: (format) => format instanceof IsobmffInputFormat,
        });
    return { hasAudio, integrity };
  } catch {
    return { hasAudio: undefined, integrity: { kind: 'unknown' } };
  } finally {
    input?.dispose();
  }
}

/**
 * The HEVC hint is shown only for this pair of facts, both read from the
 * browser: the container says HEVC, and the decoder check says no.
 */
export function isHevcWithoutDecoder(codec: string | null, decodable: boolean): boolean {
  return codec === 'hevc' && !decodable;
}

/**
 * The browser refused to open a picked video: what is the file really? Its
 * first bytes say the kind (`fileKind.ts`); for an MP4 / MOV, the container's
 * track list (the file's index, not its frames) says whether it has a
 * picture at all and — for HEVC — the browser's own decoder check,
 * `VideoDecoder.isConfigSupported` with the file's real configuration, says
 * whether a decoder is missing. Any doubt keeps the general sentence
 * (`unsupported_preview`): the hint is never a guess.
 */
async function explainRefusal(file: File): Promise<ProbeOutcome> {
  const general: ProbeOutcome = { ok: false, reason: 'unsupported_preview' };
  const kind = await readFileKind(file);
  if (kind === 'empty') return { ok: false, reason: 'empty_file' };
  if (kind === 'image') return { ok: false, reason: 'not_video_picture' };
  if (kind === 'audio') return { ok: false, reason: 'sound_only' };
  if (kind === 'unknown') return { ok: false, reason: 'not_video' };
  const typeName = foreignVideoName(kind);
  if (typeName !== null) return { ok: false, reason: 'foreign_type', typeName };
  if (kind !== 'isobmff') return general;

  // An index that cannot be true is damage, not a missing decoder (and must not be read frame by frame);
  // no index at all and a file that stops inside its data is a download that stopped half way.
  const index = await checkMp4Index(file);
  if (index === 'broken') return { ok: false, reason: 'damaged' };
  if (index === 'truncated') return { ok: false, reason: 'cut_short' };
  let input: { dispose(): void } | null = null;
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
    const opened = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    input = opened;
    const track = await opened.getPrimaryVideoTrack();
    if (!track) return (await opened.getPrimaryAudioTrack()) ? { ok: false, reason: 'sound_only' } : general;
    const codec = await track.getCodec();
    if (codec !== 'hevc') return general;
    const config = await track.getDecoderConfig();
    if (!config || typeof VideoDecoder === 'undefined') return general;
    const support = await VideoDecoder.isConfigSupported(config);
    return isHevcWithoutDecoder(codec, support.supported === true) ? { ...general, hint: 'hevc_decoder_missing' } : general;
  } catch {
    return general;
  } finally {
    input?.dispose();
  }
}

export function probeVideoFile(file: File, limits: Limits): Promise<ProbeOutcome> {
  return probeFile(file, 'video', limits);
}

export function probeAudioFile(file: File, limits: Limits): Promise<ProbeOutcome> {
  return probeFile(file, 'audio', limits);
}

/** Shown verbatim in the UI as text content — never as HTML. */
export function safeFileName(name: string, maxLength = 80): string {
  const collapsed = name.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1)}…`;
}
