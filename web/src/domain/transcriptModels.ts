/**
 * The speech models of "Yazıya dök" (ADR-036): which files, from where, how
 * large, and the sha256 every downloaded byte is checked against.
 *
 * The list itself is `modelManifest.json` (also read by
 * `scripts/fetch-models.mjs`, which puts the same files next to the site at
 * build time). Nothing here is user data: these are the app's own files.
 *
 * Pure: no fetch, no storage. The store adapter (`adapters/transcript/
 * modelStore.ts`) does the downloading; this module says what "complete and
 * unchanged" means.
 */

import manifestJson from './modelManifest.json';

export type TranscriptModelId = 'base' | 'turbo';
export type ModelGroupId = 'runtime' | 'vad' | TranscriptModelId;

export interface ModelFile {
  /** Path inside the group's folder, as the recogniser asks for it. */
  path: string;
  bytes: number;
  /** Lower-case hex. */
  sha256: string;
}

export interface ModelGroup {
  /** Folder under `<site>/models/`; carries the pinned revision, so a new pin is a new address. */
  dir: string;
  files: readonly ModelFile[];
}

export interface ModelManifest {
  /** Names the Cache Storage cache: `clip-models-v<storeVersion>`. */
  storeVersion: number;
  groups: Record<ModelGroupId, ModelGroup>;
}

export const MODEL_MANIFEST: ModelManifest = {
  storeVersion: manifestJson.storeVersion,
  groups: {
    runtime: { dir: manifestJson.groups.runtime.dir, files: manifestJson.groups.runtime.files },
    vad: { dir: manifestJson.groups.vad.dir, files: manifestJson.groups.vad.files },
    base: { dir: manifestJson.groups.base.dir, files: manifestJson.groups.base.files },
    turbo: { dir: manifestJson.groups.turbo.dir, files: manifestJson.groups.turbo.files },
  },
};

/** How each model runs. The pairs are the ones measured in the October spike. */
export interface ModelRuntime {
  device: 'wasm' | 'webgpu';
  dtype: { encoder_model: string; decoder_model_merged: string };
  /**
   * The word times of these exports come out late by a constant (spike §6.4:
   * the median signed error on one file, judged on others). Word starts and
   * word ends each have their own; both are subtracted.
   */
  timingOffset: { startUs: number; endUs: number };
}

export const MODEL_RUNTIME: Record<TranscriptModelId, ModelRuntime> = {
  base: { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, timingOffset: { startUs: 190_000, endUs: 200_000 } },
  turbo: { device: 'webgpu', dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }, timingOffset: { startUs: 204_000, endUs: 203_000 } },
};

export const TRANSCRIPT_MODELS: readonly TranscriptModelId[] = ['base', 'turbo'];

/** The groups a model needs to run: the runtime, the speech detector, its own files. */
export function groupsFor(model: TranscriptModelId): readonly ModelGroupId[] {
  return ['runtime', 'vad', model];
}

export interface StoredFileRef extends ModelFile {
  group: ModelGroupId;
  /** `<dir>/<path>`: the address under `<site>/models/` and the key in the store. */
  key: string;
}

export function filesFor(model: TranscriptModelId, manifest: ModelManifest = MODEL_MANIFEST): StoredFileRef[] {
  return groupsFor(model).flatMap((group) => {
    const entry = manifest.groups[group];
    return entry.files.map((file) => ({ ...file, group, key: `${entry.dir}/${file.path}` }));
  });
}

/** Bytes a model costs to download when nothing is stored yet. */
export function downloadBytes(model: TranscriptModelId, manifest: ModelManifest = MODEL_MANIFEST): number {
  return filesFor(model, manifest).reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * Bytes still to download given what is already stored and verified
 * (the runtime and the speech detector are shared by both models).
 */
export function missingBytes(
  model: TranscriptModelId,
  storedKeys: ReadonlySet<string>,
  manifest: ModelManifest = MODEL_MANIFEST,
): number {
  return filesFor(model, manifest)
    .filter((file) => !storedKeys.has(file.key))
    .reduce((sum, file) => sum + file.bytes, 0);
}

/** Large files are stored (and resumed) in parts of this size. */
export const MODEL_PART_BYTES = 32 * 1024 * 1024;

export interface PartRange {
  index: number;
  /** Half-open byte range. */
  start: number;
  end: number;
}

export function partsOf(bytes: number, partBytes: number = MODEL_PART_BYTES): PartRange[] {
  if (bytes <= 0) return [{ index: 0, start: 0, end: 0 }];
  const parts: PartRange[] = [];
  for (let start = 0, index = 0; start < bytes; start += partBytes, index += 1) {
    parts.push({ index, start, end: Math.min(bytes, start + partBytes) });
  }
  return parts;
}

export type FileCheck = { ok: true } | { ok: false; reason: 'size_mismatch' | 'hash_mismatch' };

/** The one rule for accepting a downloaded file: exact length and exact sha256. */
export function checkFile(expected: ModelFile, actual: { bytes: number; sha256: string }): FileCheck {
  if (actual.bytes !== expected.bytes) return { ok: false, reason: 'size_mismatch' };
  if (actual.sha256.toLowerCase() !== expected.sha256.toLowerCase()) return { ok: false, reason: 'hash_mismatch' };
  return { ok: true };
}

/** A manifest is usable only when every file has a plausible pin. Guards the test override too. */
export function isModelManifest(value: unknown): value is ModelManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { storeVersion?: unknown; groups?: unknown };
  if (typeof candidate.storeVersion !== 'number' || typeof candidate.groups !== 'object' || candidate.groups === null) {
    return false;
  }
  const groups = candidate.groups as Record<string, unknown>;
  return (['runtime', 'vad', 'base', 'turbo'] as const).every((id) => {
    const group = groups[id] as { dir?: unknown; files?: unknown } | undefined;
    if (!group || typeof group.dir !== 'string' || !/^[A-Za-z0-9._-]+$/.test(group.dir) || !Array.isArray(group.files)) {
      return false;
    }
    return group.files.every((file: unknown) => {
      const item = file as { path?: unknown; bytes?: unknown; sha256?: unknown };
      return (
        typeof item.path === 'string' &&
        /^[A-Za-z0-9._/-]+$/.test(item.path) &&
        !item.path.includes('..') &&
        Number.isSafeInteger(item.bytes) &&
        (item.bytes as number) >= 0 &&
        typeof item.sha256 === 'string' &&
        /^[0-9a-f]{64}$/.test(item.sha256)
      );
    });
  });
}
