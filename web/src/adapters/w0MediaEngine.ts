/**
 * The W0 MediaEngine: probe + honest capability report. No encoder.
 *
 * `assess()` always returns `canExport: false` with
 * `export_engine_not_implemented` at the top of the blocker list. Detecting
 * `VideoEncoder` in the browser is reported as information only — doc 11 is
 * explicit that being able to play a file, or having the API present, is not
 * evidence that H.264 + AAC output works. W1 replaces this adapter.
 */

import type { ProjectV1 } from '../domain/edl';
import type { CapabilityBlocker, CapabilityReport, MediaEngine, ProbeResult } from '../domain/mediaEngine';
import type { ExportPolicy } from '../domain/policy';
import { totalOutputDurationUs, totalSourceDurationUs } from '../domain/timeline';
import { probeVideoFile } from './browserMedia';

export class ExportNotImplementedError extends Error {
  readonly code = 'export_engine_not_implemented';
  constructor() {
    super('W0 has no encoder. Export is unavailable by design.');
    this.name = 'ExportNotImplementedError';
  }
}

export function detectEncoderApis(): CapabilityReport['detected'] {
  if (typeof window === 'undefined') {
    return { videoEncoderApi: false, audioEncoderApi: false, secureContext: false };
  }
  return {
    videoEncoderApi: typeof (window as { VideoEncoder?: unknown }).VideoEncoder === 'function',
    audioEncoderApi: typeof (window as { AudioEncoder?: unknown }).AudioEncoder === 'function',
    secureContext: window.isSecureContext === true,
  };
}

export function assessProject(
  project: ProjectV1,
  policy: ExportPolicy,
  totalSourceBytes: number,
): CapabilityReport {
  const detected = detectEncoderApis();
  const blockers: CapabilityBlocker[] = ['export_engine_not_implemented'];

  if (!detected.videoEncoderApi) blockers.push('video_encoder_api_missing');
  if (!detected.audioEncoderApi) blockers.push('audio_encoder_api_missing');
  if (!detected.secureContext) blockers.push('insecure_context');
  if (project.clips.length === 0) blockers.push('no_clips');
  if (totalOutputDurationUs(project) > policy.maxOutputDurationUs) {
    blockers.push('output_duration_exceeds_policy');
  }
  if (totalSourceDurationUs(project) > policy.maxTotalSourceDurationUs) {
    blockers.push('source_duration_exceeds_policy');
  }
  if (totalSourceBytes > policy.maxTotalSourceBytes) {
    blockers.push('source_bytes_exceed_policy');
  }

  return { canExport: false, blockers, detected };
}

export function createW0MediaEngine(policy: ExportPolicy): MediaEngine {
  return {
    async probe(file: File): Promise<ProbeResult> {
      const outcome = await probeVideoFile(file, {
        maxBytes: policy.maxTotalSourceBytes,
        maxDurationUs: policy.maxTotalSourceDurationUs,
      });
      if (!outcome.ok) throw new Error(outcome.reason);
      const { release, ...probe } = outcome.handle;
      release();
      return probe;
    },
    async assess(project: ProjectV1, assessPolicy: ExportPolicy): Promise<CapabilityReport> {
      return assessProject(project, assessPolicy, 0);
    },
    async dispose(): Promise<void> {
      // No worker, no decoder, nothing retained in W0.
    },
  };
}
