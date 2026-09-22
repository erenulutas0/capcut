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
 */

import { BufferTarget, Mp4OutputFormat, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny';

import type { StorageShortfall } from '@/domain/exportEvents';
import { hasRoomForOutput } from '@/domain/outputStorage';
import type { OutputRouteAvailability } from '@/domain/policy';

import { EXPORT_ENTRY_PREFIX, opfsRoot } from './opfsEntries';

export type OutputRoute = 'opfs' | 'memory';

/** The muxer's own writes are small; batching them keeps disk I/O sane. */
const CHUNK_SIZE = 4 * 1024 * 1024;

export interface CollectedOutput {
  route: OutputRoute;
  sizeBytes: number;
  /** Present for the memory route. */
  bytes: Uint8Array | null;
  /** Present for the OPFS route: a disk-backed file and its entry name. */
  file: File | null;
  entryName: string | null;
}

export interface PreparedOutput {
  route: OutputRoute;
  /**
   * `opfs`, or why the disk route was not available. The caller decides with
   * the policy whether a memory-route export of this length may run at all.
   */
  availability: OutputRouteAvailability;
  /** With `not_enough_space`: what was needed and what the browser reported. */
  storage: StorageShortfall | null;
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
    target: new BufferTarget(),
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    async collect(target: Target) {
      const buffer = (target as BufferTarget).buffer;
      const bytes = buffer ? new Uint8Array(buffer) : new Uint8Array();
      return { route: 'memory', sizeBytes: bytes.byteLength, bytes, file: null, entryName: null };
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
  } = {},
): Promise<PreparedOutput> {
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
    target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_SIZE }),
    // moov at the end: nothing has to be held back to write it first.
    format: new Mp4OutputFormat({ fastStart: false }),
    async collect() {
      trimAndClose();
      const file = await handle.getFile();
      return { route: 'opfs', sizeBytes: file.size || written, bytes: null, file, entryName };
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
