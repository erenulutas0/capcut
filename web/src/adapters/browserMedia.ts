/**
 * Browser media adapter: local file -> real metadata + a session-scoped handle.
 *
 * Rules this file exists to enforce:
 * - the source file is never read into app state, never base64'd, never uploaded;
 * - an object URL is a session handle, not an asset address (doc 11);
 * - every handle has one owner and one `release()`.
 */

import { secondsToUs, type Micros } from '../domain/time';
import type { ProbeResult } from '../domain/mediaEngine';

export type ProbeFailure =
  | 'unreadable'
  | 'unsupported_preview'
  | 'unknown_duration'
  | 'timeout'
  | 'file_too_large'
  | 'source_too_long';

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

export type ProbeOutcome =
  | { ok: true; handle: MediaHandle }
  | { ok: false; reason: ProbeFailure };

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
    return { ok: false, reason: 'file_too_large' };
  }

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
        finish({ ok: false, reason: 'source_too_long' });
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
    return result;
  }

  if (result.handle.hasAudio === undefined) {
    const fromContainer = await detectHasAudioFromContainer(file);
    if (fromContainer !== undefined) {
      result.handle.hasAudio = fromContainer;
    }
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
 * Authoritative answer from the demuxer: it reads the container's track list
 * instead of guessing from a media element. Returns `undefined` only when the
 * file cannot be parsed here at all.
 */
async function detectHasAudioFromContainer(file: File): Promise<boolean | undefined> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const audioTrack = await input.getPrimaryAudioTrack();
    return audioTrack !== null;
  } catch {
    return undefined;
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
