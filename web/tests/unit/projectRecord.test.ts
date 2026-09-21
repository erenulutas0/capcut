import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ProjectV1 } from '@/domain/edl';
import { US_PER_SECOND } from '@/domain/time';
import {
  bindingFor,
  compareBinding,
  computeFingerprint,
  createRecord,
  missingBindings,
  parseRecord,
  type AssetBinding,
} from '@/domain/projectRecord';

const edl: ProjectV1 = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'edl', 'valid', 'doc10-example.json'), 'utf8'),
);

const file = {
  name: 'tatil.mp4',
  size: 12_345_678,
  lastModified: 1_700_000_000_000,
  type: 'video/mp4',
};

const probe = { durationUs: 20 * US_PER_SECOND, displayWidth: 1080, displayHeight: 1920 };

function makeBinding(): AssetBinding {
  return bindingFor('a_video_001', 'video', file, probe, new Date('2026-09-21T00:00:00.000Z'));
}

describe('asset fingerprint', () => {
  it('is stable for the same identifying fields', () => {
    const a = computeFingerprint({ sizeBytes: 100, lastModified: 5, durationUs: 1000 });
    const b = computeFingerprint({ sizeBytes: 100, lastModified: 5, durationUs: 1000 });
    expect(a).toBe(b);
  });

  it('changes when any identifying field changes', () => {
    const base = { sizeBytes: 100, lastModified: 5, durationUs: 1000 };
    const fingerprint = computeFingerprint(base);
    expect(computeFingerprint({ ...base, sizeBytes: 101 })).not.toBe(fingerprint);
    expect(computeFingerprint({ ...base, durationUs: 1001 })).not.toBe(fingerprint);
    expect(computeFingerprint({ ...base, lastModified: 6 })).not.toBe(fingerprint);
  });

  it('does not depend on the file name, because people rename files', () => {
    const renamed = bindingFor('a_video_001', 'video', { ...file, name: 'başka-ad.mp4' }, probe);
    expect(renamed.fingerprint).toBe(makeBinding().fingerprint);
  });
});

describe('recognising a re-picked file', () => {
  const binding = makeBinding();

  it('accepts the identical file', () => {
    expect(
      compareBinding(binding, {
        sizeBytes: file.size,
        lastModified: file.lastModified,
        durationUs: probe.durationUs,
        displayWidth: probe.displayWidth,
        displayHeight: probe.displayHeight,
      }),
    ).toBe('exact');
  });

  it('accepts a copy whose modification time changed', () => {
    expect(
      compareBinding(binding, {
        sizeBytes: file.size,
        lastModified: file.lastModified + 90_000,
        durationUs: probe.durationUs,
        displayWidth: probe.displayWidth,
        displayHeight: probe.displayHeight,
      }),
    ).toBe('likely');
  });

  it('tolerates a frame of duration wobble between probes', () => {
    expect(
      compareBinding(binding, {
        sizeBytes: file.size,
        lastModified: file.lastModified + 1,
        durationUs: probe.durationUs + 33_000,
        displayWidth: probe.displayWidth,
        displayHeight: probe.displayHeight,
      }),
    ).toBe('likely');
  });

  it('rejects a different file, which is the whole point', () => {
    // Same duration, different bytes: a re-encode or a different take.
    expect(
      compareBinding(binding, {
        sizeBytes: file.size + 1024,
        lastModified: file.lastModified,
        durationUs: probe.durationUs,
        displayWidth: probe.displayWidth,
        displayHeight: probe.displayHeight,
      }),
    ).toBe('mismatch');

    // Same size, clearly different duration.
    expect(
      compareBinding(binding, {
        sizeBytes: file.size,
        lastModified: file.lastModified,
        durationUs: probe.durationUs + 5 * US_PER_SECOND,
      }),
    ).toBe('mismatch');

    // Same size and duration, but a different frame size.
    expect(
      compareBinding(binding, {
        sizeBytes: file.size,
        lastModified: file.lastModified,
        durationUs: probe.durationUs,
        displayWidth: 1920,
        displayHeight: 1080,
      }),
    ).toBe('mismatch');
  });
});

describe('stored records', () => {
  it('round-trips through JSON', () => {
    const record = createRecord('p_local_001', 'Tatil', edl, [makeBinding()]);
    const parsed = parseRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.title).toBe('Tatil');
    expect(parsed.record.edl.clips).toHaveLength(edl.clips.length);
    expect(parsed.record.bindings[0]?.fileName).toBe('tatil.mp4');
  });

  it('holds no media: the record is small plain JSON', () => {
    const record = createRecord('p_local_001', 'Tatil', edl, [makeBinding()]);
    const text = JSON.stringify(record);
    expect(text).not.toContain('blob:');
    expect(text).not.toContain('data:');
    // A few KB, not megabytes.
    expect(text.length).toBeLessThan(8000);
  });

  it('refuses a record whose EDL does not validate', () => {
    const broken = createRecord('p_local_001', '', { ...edl, clips: [] }, []);
    expect(parseRecord(JSON.parse(JSON.stringify(broken)))).toMatchObject({ reason: 'edl_invalid' });
  });

  it('refuses a future record version rather than guessing', () => {
    const record = { ...createRecord('p', '', edl, []), recordVersion: 2 };
    expect(parseRecord(record)).toMatchObject({ reason: 'version_unsupported' });
  });

  it('refuses junk', () => {
    expect(parseRecord(null)).toMatchObject({ reason: 'not_an_object' });
    expect(parseRecord('{}')).toMatchObject({ reason: 'not_an_object' });
    const noBindings = { ...createRecord('p', '', edl, []), bindings: 'nope' };
    expect(parseRecord(noBindings)).toMatchObject({ reason: 'bindings_invalid' });
  });

  it('lists exactly the assets that still need a file', () => {
    const videoBinding = makeBinding();
    const musicBinding = bindingFor(
      'a_music_001',
      'audio',
      { name: 'muzik.m4a', size: 500_000, lastModified: 1, type: 'audio/mp4' },
      { durationUs: 30 * US_PER_SECOND },
    );
    const record = createRecord('p', '', edl, [videoBinding, musicBinding]);

    expect(missingBindings(record, []).map((b) => b.assetId)).toEqual([
      'a_video_001',
      'a_music_001',
    ]);
    expect(missingBindings(record, ['a_video_001']).map((b) => b.assetId)).toEqual(['a_music_001']);
    expect(missingBindings(record, ['a_video_001', 'a_music_001'])).toEqual([]);
  });

  it('ignores bindings the recipe no longer references', () => {
    const stale = bindingFor(
      'a_video_999',
      'video',
      { name: 'eski.mp4', size: 1, lastModified: 1, type: 'video/mp4' },
      { durationUs: 1_000_000 },
    );
    const record = createRecord('p', '', edl, [stale]);
    expect(missingBindings(record, [])).toEqual([]);
  });
});
