import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkMp4Index, judgeMoov } from '@/adapters/mp4Index';

/**
 * The fuzz run's first finding (docs/quality/2026-10-15-fuzz.md): an MP4 whose
 * timing table (`stts`) claims billions of frames froze the tab on every card,
 * because the index was read frame by frame on the page's main thread. The
 * check adds the runs up first. Fixtures are the repository's own samples,
 * changed in memory; the small committed one (tests/media/fuzz/) is the e2e's.
 */

const SAMPLE = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');
const OTHER = join(process.cwd(), 'tests', 'media', 'other-8s.mp4');
const FUZZ_FIXTURE = join(process.cwd(), 'tests', 'media', 'fuzz', 'stts-bozuk.mp4');

/** Where the content of the first box of `type` starts (after its 8-byte header). */
function contentOf(bytes: Uint8Array, type: string): number {
  const text = Buffer.from(bytes).toString('latin1');
  const at = text.indexOf(type);
  if (at < 4) throw new Error(`${type}: not in the file`);
  return at + 4;
}

function withEdit(file: string, edit: (bytes: Uint8Array) => void): Uint8Array {
  const bytes = new Uint8Array(readFileSync(file));
  edit(bytes);
  return bytes;
}

const blob = (bytes: Uint8Array) => new Blob([Uint8Array.from(bytes)]);

describe('checkMp4Index', () => {
  it('the repository samples are sane', async () => {
    expect(await checkMp4Index(blob(new Uint8Array(readFileSync(SAMPLE))))).toBe('sane');
    expect(await checkMp4Index(blob(new Uint8Array(readFileSync(OTHER))))).toBe('sane');
  });

  it('a timing run of four billion frames is broken', async () => {
    const bytes = withEdit(SAMPLE, (b) => {
      const stts = contentOf(b, 'stts');
      // version/flags (4), entry count (4), then the first run: count, delta.
      new DataView(b.buffer).setUint32(stts + 8, 0xfff00000);
    });
    expect(await checkMp4Index(blob(bytes))).toBe('broken');
  });

  it('a composition run of four billion frames is broken', async () => {
    const bytes = withEdit(SAMPLE, (b) => {
      const text = Buffer.from(b).toString('latin1');
      if (!text.includes('ctts')) return;
      new DataView(b.buffer).setUint32(contentOf(b, 'ctts') + 8, 0xfff00000);
    });
    const hasCtts = Buffer.from(bytes).toString('latin1').includes('ctts');
    expect(await checkMp4Index(blob(bytes))).toBe(hasCtts ? 'broken' : 'sane');
  });

  it('more frames listed than the file has bytes is broken', async () => {
    const bytes = withEdit(SAMPLE, (b) => {
      // stsz: version/flags (4), sample size (4), sample count (4).
      new DataView(b.buffer).setUint32(contentOf(b, 'stsz') + 8, 0x7fffffff);
    });
    expect(await checkMp4Index(blob(bytes))).toBe('broken');
  });

  it('the committed fuzz fixture is broken, and small', async () => {
    const bytes = new Uint8Array(readFileSync(FUZZ_FIXTURE));
    expect(bytes.byteLength).toBeLessThan(200 * 1024);
    expect(await checkMp4Index(blob(bytes))).toBe('broken');
  });

  it('what it cannot read is unknown, never broken', async () => {
    const sample = new Uint8Array(readFileSync(SAMPLE));
    expect(await checkMp4Index(blob(new Uint8Array(0)))).toBe('unknown');
    expect(await checkMp4Index(blob(sample.subarray(0, 40)))).toBe('unknown');
    expect(await checkMp4Index(blob(new TextEncoder().encode('not a real mp4')))).toBe('unknown');
    expect(judgeMoov(new Uint8Array(16), 1000)).toBe('unknown');
  });
});

describe('checkMp4Index: an index that never came', () => {
  it('a file cut short before its index (at the end) is truncated', async () => {
    // Rewritten with the index last, then cut: what a stopped download of such a file leaves.
    const sample = new Uint8Array(readFileSync(SAMPLE));
    const text = Buffer.from(sample).toString('latin1');
    const moovAt = text.indexOf('moov') - 4;
    const mdatAt = text.indexOf('mdat') - 4;
    if (moovAt < mdatAt) {
      // Index first: cut inside the data; the index is there, so this is sourceIntegrity's case, not this one.
      expect(await checkMp4Index(blob(sample.subarray(0, Math.floor(sample.length * 0.55))))).toBe('sane');
      // Without its index: the top-level boxes before it, then the data cut short.
      const view = new DataView(sample.buffer, sample.byteOffset);
      const moovSize = view.getUint32(moovAt);
      const noIndex = new Uint8Array(sample.length - moovSize);
      noIndex.set(sample.subarray(0, moovAt));
      noIndex.set(sample.subarray(moovAt + moovSize), moovAt);
      expect(await checkMp4Index(blob(noIndex.subarray(0, Math.floor(noIndex.length * 0.55))))).toBe('truncated');
    } else {
      expect(await checkMp4Index(blob(sample.subarray(0, Math.floor(sample.length * 0.55))))).toBe('truncated');
    }
  });
});
