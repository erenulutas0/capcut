/// <reference lib="webworker" />

/**
 * Where the encoded file goes while it is being written.
 *
 * W4 measured the in-memory route: ~340 MiB fixed cost plus about 2.2x the
 * output size, i.e. roughly 1 GB for a 5 minute 1080p export (ADR-013). The
 * output-proportional part comes from holding the finished file in memory
 * twice — once in the muxer, once as a Blob on the page.
 *
 * The OPFS route streams the file to the browser's private file system
 * instead, so the output never sits in memory and the page receives a
 * disk-backed `File`. It is used only when the browser offers OPFS sync access
 * in workers and the storage estimate says the file will fit; otherwise the
 * proven in-memory route is used and the result says which one ran.
 *
 * Policy v3 (doc 15, ADR-020): the memory route keeps a 5-minute cap. The
 * sink only reports why the disk route was unavailable; the worker applies
 * the policy before the first frame is encoded.
 *
 * ADR-026 adds a third destination: the file the user picked in the save
 * dialog (File System Access, `showSaveFilePicker`). The encoder then writes
 * straight into it and there is no second "save" step. Every export path in
 * the worker gets its destination from `prepareOutput` and checks
 * `sinkRefusal` before writing, so a different encode path (for example a
 * stream copy) writes into the same place through the same interface.
 */

import { BufferTarget, Mp4OutputFormat, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny';

import type { ExportFailureCode, StorageShortfall } from '@/domain/exportEvents';
import { hasRoomForOutput } from '@/domain/outputStorage';
import { outputRouteRefusal, type OutputRouteAvailability } from '@/domain/policy';

import { EXPORT_ENTRY_PREFIX, opfsRoot } from './opfsEntries';

export type OutputRoute = 'opfs' | 'memory' | 'file';

/** The muxer's own writes are small; batching them keeps disk I/O sane. */
const CHUNK_SIZE = 4 * 1024 * 1024;

export interface CollectedOutput {
  route: OutputRoute;
  sizeBytes: number;
  /** Present for the memory route. */
  bytes: Uint8Array | null;
  /**
   * Present for the OPFS route (a disk-backed file and its entry name) and
   * for the file route (the saved file, read back for the probe).
   */
  file: File | null;
  entryName: string | null;
  /** The file route: the name the user's file has on disk. */
  savedName: string | null;
}

export interface PreparedOutput {
  route: OutputRoute;
  /**
   * `opfs` / `file`, or why the disk route was not available. The caller
   * decides with the policy (`sinkRefusal`) whether a memory-route export of
   * this length may run at all.
   */
  availability: OutputRouteAvailability;
  /** With `not_enough_space`: what was needed and what the browser reported. */
  storage: StorageShortfall | null;
  /**
   * Set when the destination itself refused before anything was written: the
   * picked file cannot be opened for writing, or its disk has no room. No
   * frame may be encoded then; `sinkRefusal` turns it into the failure.
   */
  refused: 'output_file_unavailable' | 'output_storage_insufficient' | null;
  target: Target;
  format: Mp4OutputFormat;
  /** Call after `output.finalize()`. */
  collect(target: Target): Promise<CollectedOutput>;
  /** Removes any partial file. Safe to call more than once. */
  discard(): Promise<void>;
}

type SyncAccessHandle = {
  write(buffer: BufferSource, options?: { at?: number }): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
};

type OpfsFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
};

function memoryRoute(
  availability: Exclude<OutputRouteAvailability, 'opfs'>,
  storage: StorageShortfall | null = null,
): PreparedOutput {
  return {
    route: 'memory',
    availability,
    storage,
    refused: null,
    target: new BufferTarget(),
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    async collect(target: Target) {
      const buffer = (target as BufferTarget).buffer;
      const bytes = buffer ? new Uint8Array(buffer) : new Uint8Array();
      return { route: 'memory', sizeBytes: bytes.byteLength, bytes, file: null, entryName: null, savedName: null };
    },
    async discard() {
      // Nothing on disk; the buffer is garbage collected with the output.
    },
  };
}

/**
 * Picks the route for one export. `requiredBytes` is the space the disk route
 * needs (`requiredFreeBytes`, ADR-023): the file is written once, so it is an
 * upper estimate of the finished file, not a multiple of it.
 *
 * Two checks, both before the first frame:
 *
 * 1. `navigator.storage.estimate()`. Chromium reports a static
 *    "usage + 10 GiB" there (anti-fingerprinting), not the disk, so this only
 *    catches an export larger than that.
 * 2. The real one: the file is created at its estimated size
 *    (`truncate(requiredBytes)`). The browser charges that against its real
 *    quota and the operating system allocates it, so a disk without room
 *    refuses here, in milliseconds, instead of minutes into the encode. The
 *    space stays claimed while encoding; the file is cut to its real length
 *    when the muxer closes it.
 *
 * `forceMemory`, `storageFreeBytes` and `reserveBytes` are test hooks (see
 * `exportClient`): the path a browser without OPFS sync access would take, a
 * storage estimate with little room, and a smaller up-front claim so that a
 * test can let a small (CDP-overridden) quota run out mid-file.
 */
export async function prepareOutput(
  requestId: string,
  requiredBytes: number,
  options: {
    forceMemory?: boolean;
    storageFreeBytes?: number | null;
    reserveBytes?: number | null;
    /** ADR-026: the file the user picked in the save dialog; wins over OPFS. */
    destination?: FileSystemFileHandle | null;
  } = {},
): Promise<PreparedOutput> {
  if (options.destination) return prepareFileOutput(options.destination, requiredBytes, options.reserveBytes ?? null);
  if (options.forceMemory) return memoryRoute('no_disk_access');
  const root = await opfsRoot();
  if (!root) return memoryRoute('no_disk_access');

  let free: number;
  try {
    const estimate = await navigator.storage.estimate();
    free = options.storageFreeBytes ?? (estimate.quota ?? 0) - (estimate.usage ?? 0);
  } catch {
    return memoryRoute('no_disk_access');
  }
  const shortfall = (reason: StorageShortfall['reason']): StorageShortfall => ({
    requiredBytes,
    freeBytes: Math.max(0, Number.isFinite(free) ? free : 0),
    reason,
  });
  if (!hasRoomForOutput(free, requiredBytes)) return memoryRoute('not_enough_space', shortfall('estimate'));

  const entryName = `${EXPORT_ENTRY_PREFIX}${requestId}.mp4`;
  let handle: OpfsFileHandle;
  let access: SyncAccessHandle;
  try {
    handle = (await root.getFileHandle(entryName, { create: true })) as OpfsFileHandle;
    if (typeof handle.createSyncAccessHandle !== 'function') {
      await root.removeEntry(entryName).catch(() => undefined);
      return memoryRoute('no_disk_access');
    }
    access = await handle.createSyncAccessHandle();
  } catch {
    await root.removeEntry(entryName).catch(() => undefined);
    return memoryRoute('no_disk_access');
  }

  // Claim the space now. A browser that cannot give it throws
  // QuotaExceededError; an in-memory file system (private windows) was seen
  // to leave the size at 0 without throwing, so the size is checked too.
  const reserve = Math.max(0, Math.ceil(options.reserveBytes ?? requiredBytes));
  let reserved = false;
  try {
    access.truncate(reserve);
    access.flush();
    reserved = access.getSize() >= reserve;
  } catch {
    reserved = false;
  }
  if (!reserved) {
    try {
      access.close();
    } catch {
      // Already closed.
    }
    await root.removeEntry(entryName).catch(() => undefined);
    return memoryRoute('not_enough_space', shortfall('reservation'));
  }

  let open = true;
  let written = 0;
  const closeAccess = () => {
    if (!open) return;
    open = false;
    try {
      access.flush();
    } finally {
      access.close();
    }
  };
  // The file was created at its estimated size; give back what was not used.
  const trimAndClose = () => {
    if (!open) return;
    try {
      access.truncate(written);
    } finally {
      closeAccess();
    }
  };

  // The muxer seeks (to patch box sizes), so writes carry their own position.
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      // Past the claimed size the file grows again, and a full disk or quota
      // throws QuotaExceededError here (ADR-023).
      const count = access.write(chunk.data, { at: chunk.position });
      if (count !== chunk.data.byteLength) {
        // A short write means the disk or quota ran out mid-file.
        throw new DOMException('short write', 'QuotaExceededError');
      }
      written = Math.max(written, chunk.position + chunk.data.byteLength);
    },
    close() {
      trimAndClose();
    },
    abort() {
      closeAccess();
    },
  });

  return {
    route: 'opfs',
    availability: 'opfs',
    storage: null,
    refused: null,
    target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_SIZE }),
    // moov at the end: nothing has to be held back to write it first.
    format: new Mp4OutputFormat({ fastStart: false }),
    async collect() {
      trimAndClose();
      const file = await handle.getFile();
      return { route: 'opfs', sizeBytes: file.size || written, bytes: null, file, entryName, savedName: null };
    },
    async discard() {
      try {
        closeAccess();
      } catch {
        // Already closed.
      }
      await root.removeEntry(entryName).catch(() => undefined);
    },
  };
}

/**
 * Why a prepared destination may not be written to, or null when encoding may
 * start. Every export path in the worker calls this before its first frame:
 *
 * - the picked file could not be opened, or its disk refused the space;
 * - doc 15 v3: without the disk, only a short video may be held in memory.
 */
export function sinkRefusal(
  sink: Pick<PreparedOutput, 'availability' | 'refused' | 'storage'>,
  memoryRouteLimitUs: number,
  durationUs: number,
): { code: ExportFailureCode; storage: StorageShortfall | null } | null {
  if (sink.refused) return { code: sink.refused, storage: sink.storage };
  const refusal = outputRouteRefusal(
    { maxMemoryRouteOutputDurationUs: memoryRouteLimitUs },
    sink.availability,
    durationUs,
  );
  if (!refusal) return null;
  return { code: refusal, storage: refusal === 'output_storage_insufficient' ? sink.storage : null };
}

/** The subset of `FileSystemWritableFileStream` the file route uses. */
interface WritableFile {
  write(params: { type: 'write'; position: number; data: BufferSource }): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

type PickedFileHandle = FileSystemFileHandle & {
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableFile>;
  /** Chromium 110+: deletes the file. Optional: not in every browser. */
  remove?: () => Promise<void>;
};

/**
 * The file route (ADR-026): the encoder writes straight into the file the user
 * picked in the save dialog.
 *
 * - The writable is opened with `keepExistingData: false`. Chromium writes
 *   into a temporary `.crswap` file next to the target and moves it over the
 *   target on `close()`; an `abort()` throws the temporary file away and
 *   leaves the target untouched. So a canceled or failed export never leaves
 *   a half-written video under the chosen name.
 * - The space is claimed first, like the OPFS route (ADR-023): the
 *   temporary file is set to the estimated size with `truncate()`. A disk
 *   without room refuses there, in milliseconds, before any frame (measured
 *   in Chrome and Edge on Windows: `InvalidStateError` within 1 ms, nothing
 *   left behind after `abort()`; ADR-026). When the muxer closes the file it
 *   is cut to its real length.
 * - Writes carry their position: the muxer patches box sizes it already wrote.
 * - The save dialog creates the chosen file (empty) as soon as the user picks
 *   it. If the export then fails, that empty file is removed again, so a
 *   failure leaves nothing behind. A file that already existed (the user chose
 *   to replace it) is left as it was, because the temporary file is dropped.
 */
async function prepareFileOutput(
  handle: FileSystemFileHandle,
  requiredBytes: number,
  reserveBytes: number | null,
): Promise<PreparedOutput> {
  const picked = handle as PickedFileHandle;
  const refuse = (
    refused: NonNullable<PreparedOutput['refused']>,
    storage: StorageShortfall | null = null,
  ): PreparedOutput => ({
    route: 'file',
    availability: 'file',
    storage,
    refused,
    target: new BufferTarget(),
    format: new Mp4OutputFormat({ fastStart: false }),
    async collect() {
      throw new Error('refused');
    },
    async discard() {},
  });

  // Empty before we start: created by the save dialog, so ours to remove on failure.
  let createdByDialog = false;
  try {
    createdByDialog = (await picked.getFile()).size === 0;
  } catch {
    createdByDialog = false;
  }
  const removeIfOurs = async () => {
    if (!createdByDialog) return;
    try {
      await picked.remove?.();
    } catch {
      // Not supported or already gone; the file is empty either way.
    }
  };

  let writable: WritableFile;
  try {
    writable = await picked.createWritable({ keepExistingData: false });
  } catch {
    await removeIfOurs();
    return refuse('output_file_unavailable');
  }

  const reserve = Math.max(0, Math.ceil(reserveBytes ?? requiredBytes));
  try {
    await writable.truncate(reserve);
  } catch {
    await writable.abort().catch(() => undefined);
    await removeIfOurs();
    return refuse('output_storage_insufficient', { requiredBytes, freeBytes: 0, reason: 'file_reservation' });
  }

  let state: 'open' | 'closed' | 'aborted' = 'open';
  let written = 0;
  const commit = async () => {
    if (state !== 'open') return;
    state = 'closed';
    // Give back the part of the claim the file did not use, then let the
    // browser move the finished file over the chosen name.
    await writable.truncate(written);
    await writable.close();
  };
  const abort = async () => {
    if (state !== 'open') return;
    state = 'aborted';
    await writable.abort().catch(() => undefined);
  };

  const stream = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      // The reservation above already holds the space, so a full disk is
      // not expected here. What a native file throws when the disk does
      // fill up mid-write was not measured (ADR-026): a QuotaExceededError
      // is reported as `output_storage_full`, anything else as a plain
      // failure, and either way the temporary file is dropped.
      await writable.write({ type: 'write', position: chunk.position, data: chunk.data });
      written = Math.max(written, chunk.position + chunk.data.byteLength);
    },
    async close() {
      await commit();
    },
    async abort() {
      await abort();
    },
  });

  return {
    route: 'file',
    availability: 'file',
    storage: null,
    refused: null,
    target: new StreamTarget(stream, { chunked: true, chunkSize: CHUNK_SIZE }),
    format: new Mp4OutputFormat({ fastStart: false }),
    async collect() {
      await commit();
      const file = await picked.getFile();
      return { route: 'file', sizeBytes: file.size || written, bytes: null, file, entryName: null, savedName: picked.name };
    },
    async discard() {
      if (state === 'open') {
        await abort();
        await removeIfOurs();
        return;
      }
      if (state === 'closed') {
        // The file was written but did not verify: it must not stay behind
        // under the chosen name as if it were the result.
        state = 'aborted';
        if (picked.remove) {
          await picked.remove().catch(() => undefined);
        } else {
          const empty = await picked.createWritable({ keepExistingData: false }).catch(() => null);
          await empty?.close().catch(() => undefined);
        }
      }
    },
  };
}
