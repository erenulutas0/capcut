/**
 * The speech model files in this browser (ADR-036).
 *
 * Where: Cache Storage, in a cache of its own (`clip-models-v<n>`). The
 * service worker's cache (`clip-app-*`, ADR-031) holds the app and only the
 * app; it never lists, stores or deletes these files, and this module never
 * touches the app's cache.
 *
 * From where: this site and nowhere else — `<site>/models/<dir>/<path>`, the
 * files `scripts/fetch-models.mjs` placed there at build time.
 *
 * How: a file is fetched in parts (HTTP Range) and each finished part is
 * stored at once, so an interrupted download continues with the next part
 * instead of starting over. When all parts are there the whole file is read
 * back through SHA-256 and compared with the pinned value; only then is it
 * marked usable. A file that does not match is deleted and reported — it is
 * never used and never marked.
 *
 * Runs in a window or in a worker (the download and the check run in the
 * transcript worker, off the UI thread).
 */

import { BASE_PATH } from '@/basePath';
import { Sha256 } from '@/domain/sha256';
import {
  MODEL_MANIFEST,
  checkFile,
  filesFor,
  partsOf,
  type ModelManifest,
  type StoredFileRef,
  type TranscriptModelId,
} from '@/domain/transcriptModels';

export const MODEL_CACHE_PREFIX = 'clip-models-';

export function modelCacheName(manifest: ModelManifest = MODEL_MANIFEST): string {
  return `${MODEL_CACHE_PREFIX}v${manifest.storeVersion}`;
}

/** Why a download stopped. Never a raw error text: it can carry addresses. */
export type DownloadFailure =
  | 'offline'
  | 'not_found'
  | 'server_error'
  | 'hash_mismatch'
  | 'no_space'
  | 'storage_failed'
  | 'unavailable';

export type DownloadOutcome = { ok: true } | { ok: false; reason: DownloadFailure; file?: string };

export interface DownloadProgress {
  /** Bytes of this model already stored, parts of unfinished files included. */
  bytesDone: number;
  bytesTotal: number;
  phase: 'downloading' | 'checking';
}

function origin(): string {
  return (globalThis as { location?: { origin?: string } }).location?.origin ?? '';
}

export function modelFileUrl(key: string): string {
  return `${origin()}${BASE_PATH}/models/${key}`;
}

const partUrl = (key: string, index: number) => `${modelFileUrl(key)}?part=${index}`;
const markUrl = (key: string) => `${modelFileUrl(key)}?verified=1`;

function storageAvailable(): boolean {
  return typeof caches !== 'undefined';
}

async function openStore(manifest: ModelManifest): Promise<Cache> {
  return caches.open(modelCacheName(manifest));
}

async function isMarked(cache: Cache, file: StoredFileRef): Promise<boolean> {
  const mark = await cache.match(markUrl(file.key));
  if (!mark) return false;
  try {
    const value = (await mark.json()) as { sha256?: unknown; bytes?: unknown };
    return value.sha256 === file.sha256 && value.bytes === file.bytes;
  } catch {
    return false;
  }
}

/** The files of `model` that are stored AND verified. */
export async function storedKeys(
  model: TranscriptModelId,
  manifest: ModelManifest = MODEL_MANIFEST,
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!storageAvailable()) return keys;
  // `has` first: asking must not create an empty cache.
  if (!(await caches.has(modelCacheName(manifest)))) return keys;
  const cache = await openStore(manifest);
  for (const file of filesFor(model, manifest)) {
    if (await isMarked(cache, file)) keys.add(file.key);
  }
  return keys;
}

export interface ModelStatus {
  ready: boolean;
  totalBytes: number;
  /** Bytes still to fetch (whole files; parts of an unfinished file are not counted as done here). */
  missingBytes: number;
}

export async function modelStatus(
  model: TranscriptModelId,
  manifest: ModelManifest = MODEL_MANIFEST,
): Promise<ModelStatus> {
  const files = filesFor(model, manifest);
  const stored = await storedKeys(model, manifest).catch(() => new Set<string>());
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const missingBytes = files.filter((file) => !stored.has(file.key)).reduce((sum, file) => sum + file.bytes, 0);
  return { ready: missingBytes === 0 && files.length > 0, totalBytes, missingBytes };
}

/** Bytes the speech models occupy in this browser (every stored part). */
export async function storedModelBytes(): Promise<number> {
  if (!storageAvailable()) return 0;
  let total = 0;
  for (const name of await caches.keys()) {
    if (!name.startsWith(MODEL_CACHE_PREFIX)) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (!request.url.includes('?part=')) continue;
      const response = await cache.match(request);
      const length = Number(response?.headers.get('content-length') ?? Number.NaN);
      total += Number.isFinite(length) ? length : ((await response?.blob())?.size ?? 0);
    }
  }
  return total;
}

/** "Modeli sil": every model cache of this app, and only those. */
export async function deleteStoredModels(): Promise<void> {
  if (!storageAvailable()) return;
  for (const name of await caches.keys()) {
    if (name.startsWith(MODEL_CACHE_PREFIX)) await caches.delete(name);
  }
}

async function deleteFile(cache: Cache, file: StoredFileRef): Promise<void> {
  await cache.delete(markUrl(file.key));
  for (const part of partsOf(file.bytes)) await cache.delete(partUrl(file.key, part.index));
}

async function storedPart(cache: Cache, file: StoredFileRef, index: number, length: number): Promise<Blob | null> {
  const response = await cache.match(partUrl(file.key, index));
  if (!response) return null;
  const blob = await response.blob();
  return blob.size === length ? blob : null;
}

/** The verified file as one Blob (its parts, not copied), or null. */
export async function readModelFile(
  file: StoredFileRef,
  manifest: ModelManifest = MODEL_MANIFEST,
): Promise<Blob | null> {
  if (!storageAvailable() || !(await caches.has(modelCacheName(manifest)))) return null;
  const cache = await openStore(manifest);
  if (!(await isMarked(cache, file))) return null;
  const blobs: Blob[] = [];
  for (const part of partsOf(file.bytes)) {
    const blob = await storedPart(cache, file, part.index, part.end - part.start);
    if (!blob) return null;
    blobs.push(blob);
  }
  return new Blob(blobs);
}

class DownloadError extends Error {
  constructor(
    readonly reason: DownloadFailure,
    readonly file?: string,
  ) {
    super(reason);
  }
}

/** Reads a response body, reporting bytes as they arrive. */
async function readBody(response: Response, onBytes: (count: number) => void): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  const reader = response.body?.getReader();
  if (!reader) {
    const all = new Uint8Array(await response.arrayBuffer());
    onBytes(all.length);
    return [all];
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      onBytes(value.length);
    }
  }
  return chunks;
}

async function fetchPart(url: string, range: { start: number; end: number } | null): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      // The model store is the cache; the HTTP cache must not keep a second copy.
      cache: 'no-store',
      credentials: 'omit',
      ...(range ? { headers: { Range: `bytes=${range.start}-${range.end - 1}` } } : {}),
    });
  } catch {
    throw new DownloadError('offline');
  }
  if (response.status === 404) throw new DownloadError('not_found');
  if (!response.ok) throw new DownloadError('server_error');
  return response;
}

async function putPart(cache: Cache, url: string, chunks: BlobPart[], length: number): Promise<void> {
  try {
    await cache.put(
      url,
      new Response(new Blob(chunks), {
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(length) },
      }),
    );
  } catch {
    throw new DownloadError('no_space');
  }
}

/** Downloads the parts of one file that are not stored yet. */
async function downloadFile(cache: Cache, file: StoredFileRef, onBytes: (count: number) => void): Promise<void> {
  const parts = partsOf(file.bytes);
  const url = modelFileUrl(file.key);
  for (const part of parts) {
    const length = part.end - part.start;
    if (await storedPart(cache, file, part.index, length)) continue;
    const ranged = parts.length > 1;
    const response = await fetchPart(url, ranged ? part : null);
    let counted = 0;
    const count = (bytes: number) => {
      counted += bytes;
      onBytes(bytes);
    };
    if (ranged && response.status === 200) {
      // The host ignored Range and sent the whole file: store every part from this one body.
      let chunks: Uint8Array[];
      try {
        chunks = await readBody(response, () => undefined);
      } catch {
        throw new DownloadError('offline');
      }
      const whole = new Blob(chunks as BlobPart[]);
      if (whole.size !== file.bytes) throw new DownloadError('hash_mismatch', file.key);
      for (const each of parts) {
        if (await storedPart(cache, file, each.index, each.end - each.start)) continue;
        await putPart(cache, partUrl(file.key, each.index), [whole.slice(each.start, each.end)], each.end - each.start);
        onBytes(each.end - each.start);
      }
      return;
    }
    let chunks: Uint8Array[];
    try {
      chunks = await readBody(response, count);
    } catch {
      // The connection dropped mid-part: what was counted for this part is taken back.
      onBytes(-counted);
      throw new DownloadError('offline');
    }
    const got = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (got !== length) {
      onBytes(-counted);
      // A short or long body is not this file (an error page, a truncated transfer).
      throw new DownloadError(got < length ? 'offline' : 'hash_mismatch', file.key);
    }
    await putPart(cache, partUrl(file.key, part.index), chunks as BlobPart[], length);
  }
}

/** Reads the stored parts back through SHA-256. */
async function verifyFile(cache: Cache, file: StoredFileRef): Promise<boolean> {
  const hash = new Sha256();
  let bytes = 0;
  for (const part of partsOf(file.bytes)) {
    const blob = await storedPart(cache, file, part.index, part.end - part.start);
    if (!blob) return false;
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        hash.update(value);
        bytes += value.length;
      }
    }
  }
  return checkFile(file, { bytes, sha256: hash.digestHex() }).ok;
}

/** Bytes of `file` already stored as whole parts. */
async function storedPartBytes(cache: Cache, file: StoredFileRef): Promise<number> {
  let total = 0;
  for (const part of partsOf(file.bytes)) {
    if (await storedPart(cache, file, part.index, part.end - part.start)) total += part.end - part.start;
  }
  return total;
}

/** Files of pins this build no longer names (an older model revision) are removed. */
async function pruneStale(manifest: ModelManifest): Promise<void> {
  for (const name of await caches.keys()) {
    if (name.startsWith(MODEL_CACHE_PREFIX) && name !== modelCacheName(manifest)) await caches.delete(name);
  }
  const cache = await openStore(manifest);
  const prefixes = Object.values(manifest.groups).map((group) => modelFileUrl(`${group.dir}/`));
  for (const request of await cache.keys()) {
    if (!prefixes.some((prefix) => request.url.startsWith(prefix))) await cache.delete(request);
  }
}

/**
 * Downloads what `model` still lacks, verifies it, and marks it usable.
 * Safe to call again after a failure: stored parts are kept and skipped.
 */
export async function downloadModel(
  model: TranscriptModelId,
  onProgress: (progress: DownloadProgress) => void,
  manifest: ModelManifest = MODEL_MANIFEST,
): Promise<DownloadOutcome> {
  if (!storageAvailable()) return { ok: false, reason: 'unavailable' };
  let cache: Cache;
  try {
    await pruneStale(manifest);
    cache = await openStore(manifest);
  } catch {
    return { ok: false, reason: 'storage_failed' };
  }
  const files = filesFor(model, manifest);
  const bytesTotal = files.reduce((sum, file) => sum + file.bytes, 0);
  const pending: StoredFileRef[] = [];
  let bytesDone = 0;
  for (const file of files) {
    if (await isMarked(cache, file)) {
      bytesDone += file.bytes;
    } else {
      pending.push(file);
      bytesDone += await storedPartBytes(cache, file);
    }
  }

  // Refuse before the first byte when the browser says there is no room.
  const need = bytesTotal - bytesDone;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < need * 1.05) {
      return { ok: false, reason: 'no_space' };
    }
  } catch {
    // No estimate: the write itself will say when the space runs out.
  }
  // Ask that the browser does not evict the files under storage pressure. The answer does not change the flow.
  void navigator.storage?.persist?.().catch(() => false);

  let lastPost = 0;
  const report = (phase: DownloadProgress['phase'], force = false) => {
    const now = Date.now();
    if (!force && now - lastPost < 100) return;
    lastPost = now;
    onProgress({ bytesDone: Math.max(0, Math.min(bytesTotal, bytesDone)), bytesTotal, phase });
  };
  report('downloading', true);

  try {
    for (const file of pending) {
      await downloadFile(cache, file, (count) => {
        bytesDone += count;
        report('downloading');
      });
      report('checking', true);
      if (!(await verifyFile(cache, file))) {
        await deleteFile(cache, file);
        return { ok: false, reason: 'hash_mismatch', file: file.key };
      }
      await cache.put(
        markUrl(file.key),
        new Response(JSON.stringify({ sha256: file.sha256, bytes: file.bytes }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      report('downloading', true);
    }
  } catch (error) {
    if (error instanceof DownloadError) return { ok: false, reason: error.reason, ...(error.file ? { file: error.file } : {}) };
    return { ok: false, reason: 'storage_failed' };
  }
  report('downloading', true);
  return { ok: true };
}
