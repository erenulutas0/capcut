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
 */

import { BufferTarget, Mp4OutputFormat, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny';

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
  target: Target;
  format: Mp4OutputFormat;
  /** Call after `output.finalize()`. */
  collect(target: Target): Promise<CollectedOutput>;
  /** Removes any partial file. Safe to call more than once. */
  discard(): Promise<void>;
}

type SyncAccessHandle = {
  write(buffer: BufferSource, options?: { at?: number }): number;
  flush(): void;
  close(): void;
};

type OpfsFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
};

function memoryRoute(): PreparedOutput {
  return {
    route: 'memory',
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
 * Picks the route for one export. `expectedBytes` is an upper estimate of the
 * finished file; the storage estimate must leave room for it twice over.
 */
export async function prepareOutput(requestId: string, expectedBytes: number): Promise<PreparedOutput> {
  const root = await opfsRoot();
  if (!root) return memoryRoute();

  try {
    const estimate = await navigator.storage.estimate();
    const free = (estimate.quota ?? 0) - (estimate.usage ?? 0);
    if (free < expectedBytes * 2) return memoryRoute();
  } catch {
    return memoryRoute();
  }

  const entryName = `${EXPORT_ENTRY_PREFIX}${requestId}.mp4`;
  let handle: OpfsFileHandle;
  let access: SyncAccessHandle;
  try {
    handle = (await root.getFileHandle(entryName, { create: true })) as OpfsFileHandle;
    if (typeof handle.createSyncAccessHandle !== 'function') {
      await root.removeEntry(entryName).catch(() => undefined);
      return memoryRoute();
    }
    access = await handle.createSyncAccessHandle();
  } catch {
    await root.removeEntry(entryName).catch(() => undefined);
    return memoryRoute();
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

  // The muxer seeks (to patch box sizes), so writes carry their own position.
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      const count = access.write(chunk.data, { at: chunk.position });
      if (count !== chunk.data.byteLength) {
        // A short write means the disk or quota ran out mid-file.
        throw new DOMException('short write', 'QuotaExceededError');
      }
      written = Math.max(written, chunk.position + chunk.data.byteLength);
    },
    close() {
      closeAccess();
    },
    abort() {
      closeAccess();
    },
  });

  return {
    route: 'opfs',
    target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_SIZE }),
    // moov at the end: nothing has to be held back to write it first.
    format: new Mp4OutputFormat({ fastStart: false }),
    async collect() {
      closeAccess();
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
