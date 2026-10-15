/**
 * The stored project (doc 10 "Repository alanları").
 *
 * A record holds the EDL plus enough information to recognise the user's files
 * again later. It never holds media: browsers cannot persist a `File` across
 * sessions, and copying video bytes into storage is exactly what doc 11
 * forbids. What survives is the recipe; the files are re-selected by the user.
 */

import { EDL_SCHEMA_VERSION, type Project } from './edl';
import type { Micros } from './time';

export const PROJECT_RECORD_VERSION = 1;

/**
 * What we remember about one source file so it can be recognised again.
 *
 * The file name is stored for display only. Names change when people rename or
 * re-download a file, so identity rests on size, modification time and the
 * probed duration.
 */
export interface AssetBinding {
  assetId: string;
  kind: 'video' | 'audio';
  fileName: string;
  sizeBytes: number;
  lastModified: number;
  durationUs: Micros;
  displayWidth?: number;
  displayHeight?: number;
  mimeType: string;
  fingerprint: string;
  /** When this binding last pointed at a file we could actually read. */
  lastSeenAt: string;
}

export interface ProjectRecord {
  recordVersion: typeof PROJECT_RECORD_VERSION;
  projectId: string;
  title: string;
  edl: Project;
  bindings: AssetBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface FingerprintInput {
  sizeBytes: number;
  lastModified: number;
  durationUs: Micros;
  displayWidth?: number | undefined;
  displayHeight?: number | undefined;
}

/**
 * FNV-1a over the identifying fields. This is a recognition aid, not a
 * cryptographic hash and not a content hash: two different files could in
 * principle collide, which is why `compareBinding` also checks the fields
 * directly rather than trusting the digest alone.
 */
export function computeFingerprint(input: FingerprintInput): string {
  const body = [
    input.sizeBytes,
    input.lastModified,
    input.durationUs,
    input.displayWidth ?? 0,
    input.displayHeight ?? 0,
  ].join(':');

  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp_${hash.toString(16).padStart(8, '0')}`;
}

export type BindingMatch = 'exact' | 'likely' | 'mismatch';

/** Duration can wobble by a frame between probes of the same file. */
const DURATION_TOLERANCE_US = 50_000;

/**
 * Decides whether a newly picked file is the one the record refers to.
 *
 * `exact`    every identifying field agrees.
 * `likely`   same bytes and duration, but the modification time changed —
 *            typical after copying or re-downloading the same file.
 * `mismatch` anything else. The caller must treat it as a different source
 *            rather than silently re-pointing the existing ranges at it.
 */
export function compareBinding(binding: AssetBinding, candidate: FingerprintInput): BindingMatch {
  if (computeFingerprint(binding) === computeFingerprint(candidate)) return 'exact';

  const sameSize = binding.sizeBytes === candidate.sizeBytes;
  const sameDuration = Math.abs(binding.durationUs - candidate.durationUs) <= DURATION_TOLERANCE_US;
  const sameShape =
    (binding.displayWidth ?? 0) === (candidate.displayWidth ?? 0) &&
    (binding.displayHeight ?? 0) === (candidate.displayHeight ?? 0);

  if (sameSize && sameDuration && sameShape) return 'likely';
  return 'mismatch';
}

export function bindingFor(
  assetId: string,
  kind: 'video' | 'audio',
  file: { name: string; size: number; lastModified: number; type: string },
  probe: { durationUs: Micros; displayWidth?: number | undefined; displayHeight?: number | undefined },
  now: Date = new Date(),
): AssetBinding {
  const input: FingerprintInput = {
    sizeBytes: file.size,
    lastModified: file.lastModified,
    durationUs: probe.durationUs,
    displayWidth: probe.displayWidth,
    displayHeight: probe.displayHeight,
  };
  return {
    assetId,
    kind,
    fileName: file.name,
    sizeBytes: file.size,
    lastModified: file.lastModified,
    durationUs: probe.durationUs,
    ...(probe.displayWidth ? { displayWidth: probe.displayWidth } : {}),
    ...(probe.displayHeight ? { displayHeight: probe.displayHeight } : {}),
    mimeType: file.type || 'application/octet-stream',
    fingerprint: computeFingerprint(input),
    lastSeenAt: now.toISOString(),
  };
}

export function createRecord(
  projectId: string,
  title: string,
  edl: Project,
  bindings: AssetBinding[],
  now: Date = new Date(),
): ProjectRecord {
  const iso = now.toISOString();
  return {
    recordVersion: PROJECT_RECORD_VERSION,
    projectId,
    title,
    edl,
    bindings,
    createdAt: iso,
    updatedAt: iso,
  };
}

/**
 * True for a recipe whose schema number is higher than this build's. That
 * happens when the browser serves an older copy of the app (the service
 * worker's saved shell, a tab left open across a release) after a newer one
 * has saved: there is no way down, so the only honest answers are "not this
 * build" and hands off.
 */
export function isNewerRecipe(edl: unknown): boolean {
  if (typeof edl !== 'object' || edl === null) return false;
  const version = (edl as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) && version > EDL_SCHEMA_VERSION;
}

/** Assets referenced by the recipe that no open file currently satisfies. */
export function missingBindings(record: ProjectRecord, linkedAssetIds: readonly string[]): AssetBinding[] {
  const used = new Set(record.edl.assets.map((asset) => asset.assetId));
  return record.bindings.filter(
    (binding) => used.has(binding.assetId) && !linkedAssetIds.includes(binding.assetId),
  );
}
