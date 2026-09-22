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

const { prepareOutput } = await import('@/adapters/export/outputSink');

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
