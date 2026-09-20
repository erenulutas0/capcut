/**
 * MediaEngine port (doc 10 "Motor portu") — a behaviour contract, not an
 * implementation.
 *
 * W0 ships `probe` and `assess` only. `export` is intentionally absent from the
 * W0 adapter: there is no encoder behind it, and a method that resolves with a
 * fake success would be exactly the thing AGENTS.md forbids. W1 adds the real
 * one (`preparePreview` / `export` / `cancel`) behind the same port.
 */

import type { ProjectV1 } from './edl';
import type { ExportPolicy } from './policy';
import type { Micros } from './time';

export interface ProbeResult {
  durationUs: Micros;
  /** Orientation-corrected display size, when the platform reports it. */
  displayWidth?: number;
  displayHeight?: number;
  /**
   * `undefined` means "the platform did not tell us", not "there is no audio".
   * Browsers do not expose track lists reliably; we never guess.
   */
  hasAudio?: boolean;
  mimeType: string;
  sizeBytes: number;
}

export type CapabilityBlocker =
  | 'export_engine_not_implemented'
  | 'video_encoder_api_missing'
  | 'audio_encoder_api_missing'
  | 'insecure_context'
  | 'output_duration_exceeds_policy'
  | 'source_duration_exceeds_policy'
  | 'source_bytes_exceed_policy'
  | 'no_clips';

export interface CapabilityReport {
  /** True only when a verified route can actually produce the requested file. */
  canExport: false;
  blockers: CapabilityBlocker[];
  /** Informational: encoder APIs detected in this browser, if any. */
  detected: {
    videoEncoderApi: boolean;
    audioEncoderApi: boolean;
    secureContext: boolean;
  };
}

export interface MediaEngine {
  probe(file: File): Promise<ProbeResult>;
  assess(project: ProjectV1, policy: ExportPolicy): Promise<CapabilityReport>;
  dispose(): Promise<void>;
}
