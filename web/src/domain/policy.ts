/**
 * Local web limits. The single source of truth is
 * `video-editor-blueprint/docs/15_PRICING_FREE_PRO.md` (policy id 2026-09-19.v1)
 * plus the web guard rails in doc 11. Plan names are deliberately NOT hardcoded
 * into the domain: this is one policy object the app passes in.
 *
 * A subscription does not lift a browser's memory or codec limit (doc 11).
 */

import { US_PER_SECOND, type Micros } from './time';

export interface ExportPolicy {
  policyId: string;
  maxOutputDurationUs: Micros;
  maxTotalSourceDurationUs: Micros;
  maxTotalSourceBytes: number;
  maxVideoAssets: number;
  maxClips: number;
  maxMusicTracks: number;
  maxMusicDurationUs: Micros;
  maxMusicBytes: number;
  minGainDb: number;
  maxGainDb: number;
}

const MIB = 1_048_576;

export const WEB_LOCAL_POLICY: ExportPolicy = {
  policyId: '2026-09-19.v1/web-local',
  maxOutputDurationUs: 5 * 60 * US_PER_SECOND,
  maxTotalSourceDurationUs: 20 * 60 * US_PER_SECOND,
  maxTotalSourceBytes: 250 * MIB,
  maxVideoAssets: 5,
  maxClips: 20,
  maxMusicTracks: 1,
  maxMusicDurationUs: 10 * 60 * US_PER_SECOND,
  maxMusicBytes: 100 * MIB,
  minGainDb: -60,
  maxGainDb: 0,
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  return `${(bytes / (1024 * MIB)).toFixed(2)} GB`;
}
