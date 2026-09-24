import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The disk route claims its space before encoding and gives back what it did
 * not use (ADR-023). A fake OPFS stands in for the browser: it enforces a
 * quota on truncate and write the way Chromium's sync access handle does
 * (QuotaExceededError), so every branch can be driven from node.
 */

class FakeAccess {
  size = 0;
  closed = false;
  constructor(
    private readonly file: FakeFile,
    private readonly quota: { bytes: number; silentTruncate?: boolean },
  ) {}
  private charge(newSize: number) {
    if (newSize > this.quota.bytes) {
      throw new DOMException('No space available for this operation', 'QuotaExceededError');
    }
  }
  truncate(newSize: number) {
    if (this.quota.silentTruncate && newSize > this.quota.bytes) return; // in-memory file system
    this.charge(newSize);
    this.size = newSize;
    this.file.size = newSize;
  }
  getSize() {
    return this.size;
  }
  write(buffer: ArrayBufferView, options: { at?: number } = {}) {
    const end = (options.at ?? 0) + buffer.byteLength;
    if (end > this.size) {
      this.charge(end);
      this.size = end;
      this.file.size = end;
    }
    this.file.maxSeen = Math.max(this.file.maxSeen, this.size);
    return buffer.byteLength;
  }
  flush() {}
  close() {
    this.closed = true;
  }
}

class FakeFile {
  size = 0;
  maxSeen = 0;
  access: FakeAccess | null = null;
  constructor(private readonly quota: { bytes: number; silentTruncate?: boolean }) {}
  async createSyncAccessHandle() {
    this.access = new FakeAccess(this, this.quota);
    return this.access;
  }
  async getFile() {
    return { size: this.size } as File;
  }
}

const quota = { bytes: 0, silentTruncate: false };
const files = new Map<string, FakeFile>();
const root = {
  async getFileHandle(name: string) {
    const file = files.get(name) ?? new FakeFile(quota);
    files.set(name, file);
    return file;
  },
  async removeEntry(name: string) {
    files.delete(name);
  },
};

vi.mock('@/adapters/export/opfsEntries', () => ({
  EXPORT_ENTRY_PREFIX: 'clip-export-',
  opfsRoot: async () => root,
}));

const { prepareOutput, sinkRefusal } = await import('@/adapters/export/outputSink');

/**
 * The file picked in the save dialog (ADR-026), the way Chromium behaves:
 * writes go to a temporary swap file, `close()` moves it over the target,
 * `abort()` throws it away. `disk` limits the swap file's size.
 */
class FakePickedFile {
  size: number;
  removed = false;
  swapPeak = 0;
  openWritables = 0;
  constructor(
    readonly name: string,
    existingSize: number,
    private readonly disk: { bytes: number },
    private readonly failOpen = false,
  ) {
    this.size = existingSize;
  }
  async getFile() {
    return { size: this.size } as File;
  }
  async remove() {
    this.removed = true;
    this.size = 0;
  }
  async createWritable(options: { keepExistingData?: boolean }) {
    if (this.failOpen) throw new DOMException('denied', 'NotAllowedError');
    this.openWritables += 1;
    let swap = options.keepExistingData ? this.size : 0;
    const charge = (size: number) => {
      if (size > this.disk.bytes) throw new DOMException('disk full', 'QuotaExceededError');
      swap = size;
      this.swapPeak = Math.max(this.swapPeak, swap);
    };
    return {
      write: async (params: { type: 'write'; position: number; data: ArrayBufferView }) => {
        const end = params.position + params.data.byteLength;
        if (end > swap) charge(end);
      },
      truncate: async (size: number) => charge(size),
      close: async () => {
        this.size = swap;
        this.openWritables -= 1;
      },
      abort: async () => {
        this.openWritables -= 1;
      },
    };
  }
}

const MIB = 1_048_576;

/** The stream the muxer writes to (mediabunny keeps it on `_writable`). */
function writerOf(target: unknown) {
  const writable = (target as { _writable?: WritableStream })._writable;
  if (!writable) throw new Error('StreamTarget without a writable');
  return writable.getWriter();
}

let estimateFree = 10 * 1024 * MIB;

beforeEach(() => {
  files.clear();
  quota.bytes = 100 * MIB;
  quota.silentTruncate = false;
  estimateFree = 10 * 1024 * MIB;
  vi.stubGlobal('navigator', {
    storage: { estimate: async () => ({ quota: estimateFree + 5 * MIB, usage: 5 * MIB }) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('disk route: space claimed before encoding (ADR-023)', () => {
  it('claims the whole requirement, then trims the file to what was written', async () => {
    const sink = await prepareOutput('a', 40 * MIB);
    expect(sink.route).toBe('opfs');
    const file = files.get('clip-export-a.mp4');
    expect(file?.size).toBe(40 * MIB);

    // Write through the same stream the muxer uses.
    const w = writerOf(sink.target);
    await w.write({ type: 'write', data: new Uint8Array(3 * MIB), position: 0 });
    await w.write({ type: 'write', data: new Uint8Array(8), position: 0 }); // patch a box size
    await w.close();

    const collected = await sink.collect(sink.target);
    expect(collected.sizeBytes).toBe(3 * MIB);
    expect(file?.size).toBe(3 * MIB);
    expect(file?.access?.closed).toBe(true);
  });

  it('refuses before encoding when the browser cannot give the space, and leaves no file', async () => {
    quota.bytes = 10 * MIB;
    const sink = await prepareOutput('b', 40 * MIB);
    expect(sink.route).toBe('memory');
    expect(sink.availability).toBe('not_enough_space');
    expect(sink.storage).toEqual({ requiredBytes: 40 * MIB, freeBytes: estimateFree, reason: 'reservation' });
    expect(files.has('clip-export-b.mp4')).toBe(false);
  });

  it('treats a truncate that silently did nothing as a refusal (in-memory file system)', async () => {
    quota.bytes = 10 * MIB;
    quota.silentTruncate = true;
    const sink = await prepareOutput('c', 40 * MIB);
    expect(sink.availability).toBe('not_enough_space');
    expect(sink.storage?.reason).toBe('reservation');
    expect(files.has('clip-export-c.mp4')).toBe(false);
  });

  it('refuses on the estimate alone when it reports less than needed, with both numbers', async () => {
    estimateFree = 20 * MIB;
    const sink = await prepareOutput('d', 40 * MIB);
    expect(sink.availability).toBe('not_enough_space');
    expect(sink.storage).toEqual({ requiredBytes: 40 * MIB, freeBytes: 20 * MIB, reason: 'estimate' });
    expect(files.size).toBe(0);
  });

  it('the storage-estimate test hook still decides the first check', async () => {
    const sink = await prepareOutput('e', 40 * MIB, { storageFreeBytes: 39 * MIB });
    expect(sink.storage).toEqual({ requiredBytes: 40 * MIB, freeBytes: 39 * MIB, reason: 'estimate' });
  });

  it('a file that outgrows its claim into a full disk fails with QuotaExceededError', async () => {
    quota.bytes = 6 * MIB;
    const sink = await prepareOutput('f', 40 * MIB, { reserveBytes: MIB });
    expect(sink.route).toBe('opfs');
    const w = writerOf(sink.target);
    await w.write({ type: 'write', data: new Uint8Array(4 * MIB), position: 0 });
    await expect(w.write({ type: 'write', data: new Uint8Array(4 * MIB), position: 4 * MIB })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    await sink.discard();
    expect(files.has('clip-export-f.mp4')).toBe(false);
  });

  it('forced memory route never touches the disk', async () => {
    const sink = await prepareOutput('g', 40 * MIB, { forceMemory: true });
    expect(sink.availability).toBe('no_disk_access');
    expect(files.size).toBe(0);
  });
});

describe('file route: straight into the file picked in the save dialog (ADR-026)', () => {
  const pick = (existing = 0, diskBytes = 100 * MIB, failOpen = false) =>
    new FakePickedFile('tatil_00-12-01-40.mp4', existing, { bytes: diskBytes }, failOpen);

  it('claims the estimate in the temporary file, writes at positions, trims, and moves it into place', async () => {
    const file = pick();
    const sink = await prepareOutput('h', 40 * MIB, { destination: file as unknown as FileSystemFileHandle });
    expect(sink.route).toBe('file');
    expect(sink.availability).toBe('file');
    expect(sinkRefusal(sink, 5 * 60_000_000, 50 * 60_000_000)).toBeNull();
    expect(file.swapPeak).toBe(40 * MIB);
    // Nothing reaches the chosen name until the file is complete.
    expect(file.size).toBe(0);
    const w = writerOf(sink.target);
    await w.write({ type: 'write', data: new Uint8Array(3 * MIB), position: 0 });
    await w.write({ type: 'write', data: new Uint8Array(8), position: 16 }); // patch a box size
    await w.close();
    const collected = await sink.collect(sink.target);
    expect(collected).toMatchObject({ route: 'file', sizeBytes: 3 * MIB, savedName: 'tatil_00-12-01-40.mp4' });
    expect(file.size).toBe(3 * MIB);
    expect(file.openWritables).toBe(0);
    // OPFS is never used on this route.
    expect(files.size).toBe(0);
  });

  it('a disk without room refuses before encoding, and the empty file the dialog made is removed', async () => {
    const file = pick(0, 10 * MIB);
    const sink = await prepareOutput('i', 40 * MIB, { destination: file as unknown as FileSystemFileHandle });
    expect(sink.refused).toBe('output_storage_insufficient');
    expect(sinkRefusal(sink, 5 * 60_000_000, 60_000_000)).toEqual({
      code: 'output_storage_insufficient',
      storage: { requiredBytes: 40 * MIB, freeBytes: 0, reason: 'file_reservation' },
    });
    expect(file.removed).toBe(true);
    expect(file.openWritables).toBe(0);
  });

  it('a file that cannot be opened for writing is refused with its own reason', async () => {
    const file = pick(0, 100 * MIB, true);
    const sink = await prepareOutput('j', MIB, { destination: file as unknown as FileSystemFileHandle });
    expect(sinkRefusal(sink, 5 * 60_000_000, 60_000_000)?.code).toBe('output_file_unavailable');
    expect(file.removed).toBe(true);
  });

  it('cancel or failure mid-file leaves no half file: a new file is removed, an existing one is untouched', async () => {
    const fresh = pick();
    const sink = await prepareOutput('k', 40 * MIB, { destination: fresh as unknown as FileSystemFileHandle });
    const w = writerOf(sink.target);
    await w.write({ type: 'write', data: new Uint8Array(MIB), position: 0 });
    await sink.discard();
    expect(fresh.removed).toBe(true);
    expect(fresh.openWritables).toBe(0);

    const existing = pick(7 * MIB);
    const again = await prepareOutput('l', 40 * MIB, { destination: existing as unknown as FileSystemFileHandle });
    await writerOf(again.target).write({ type: 'write', data: new Uint8Array(MIB), position: 0 });
    await again.discard();
    expect(existing.removed).toBe(false);
    expect(existing.size).toBe(7 * MIB);
  });

  it('a disk that fills up mid-file fails with QuotaExceededError (reported as output_storage_full)', async () => {
    const file = pick(0, 6 * MIB);
    const sink = await prepareOutput('m', 40 * MIB, {
      destination: file as unknown as FileSystemFileHandle,
      reserveBytes: MIB,
    });
    expect(sink.refused).toBeNull();
    const w = writerOf(sink.target);
    await w.write({ type: 'write', data: new Uint8Array(4 * MIB), position: 0 });
    await expect(w.write({ type: 'write', data: new Uint8Array(4 * MIB), position: 4 * MIB })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    await sink.discard();
    expect(file.removed).toBe(true);
  });

  it('a written file that then fails verification does not stay under the chosen name', async () => {
    const file = pick();
    const sink = await prepareOutput('n', MIB, { destination: file as unknown as FileSystemFileHandle });
    const w = writerOf(sink.target);
    await w.write({ type: 'write', data: new Uint8Array(1000), position: 0 });
    await w.close();
    await sink.collect(sink.target);
    await sink.discard();
    expect(file.removed).toBe(true);
  });

  it('the memory-route limit still applies without a disk route', () => {
    expect(
      sinkRefusal({ availability: 'no_disk_access', refused: null, storage: null }, 5 * 60_000_000, 6 * 60_000_000),
    ).toEqual({ code: 'output_too_long_for_memory', storage: null });
  });
});
