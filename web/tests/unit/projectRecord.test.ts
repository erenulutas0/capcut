import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Project } from '@/domain/edl';
import { loadProject, loadStoredProject } from '@/domain/migration';
import { healLegacyMusic, isLegacyMusicStub } from '@/domain/musicFit';
import { US_PER_SECOND } from '@/domain/time';
import { issueCodes, validateProject, validateStoredProject } from '@/domain/validation';
import {
  bindingFor,
  compareBinding,
  computeFingerprint,
  createRecord,
  missingBindings,
  parseRecord,
  type AssetBinding,
} from '@/domain/projectRecord';

const edl: Project = JSON.parse(
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
    const reversed = { ...edl, clips: edl.clips.map((clip) => ({ ...clip, sourceOutUs: clip.sourceInUs })) };
    const broken = createRecord('p_local_001', '', reversed, []);
    expect(parseRecord(JSON.parse(JSON.stringify(broken)))).toMatchObject({ reason: 'edl_invalid' });
  });

  // ADR-026: a video is opened with no kesit, and that project is saved (ADR-012 "Ek, 10 Ekim 2026").
  describe('a project with no kesit yet', () => {
    const videoOnly: Project = {
      ...edl,
      assets: edl.assets.filter((asset) => asset.kind === 'video'),
      clips: [],
      captionTracks: [],
    };
    delete videoOnly.music;

    it('is not a recipe the export accepts, and the shared fixture still says so', () => {
      expect(issueCodes(validateProject(videoOnly))).toEqual(['clips_empty']);
      expect(issueCodes(loadProject(videoOnly))).toEqual(['clips_empty']);
      const fixture = JSON.parse(
        readFileSync(join(process.cwd(), 'fixtures', 'edl', 'invalid', 'empty-clips.json'), 'utf8'),
      );
      expect(issueCodes(validateProject(fixture))).toEqual(['clips_empty']);
      expect(validateStoredProject(fixture).ok).toBe(true);
    });

    it('opens again from a record, with the binding that asks for the video', () => {
      const record = createRecord('p_local_001', '', videoOnly, [makeBinding()]);
      const parsed = parseRecord(JSON.parse(JSON.stringify(record)));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.record.edl.clips).toEqual([]);
      expect(parsed.record.edl.schemaVersion).toBe(edl.schemaVersion);
      expect(missingBindings(parsed.record, []).map((b) => b.assetId)).toEqual(['a_video_001']);
    });

    it('opens again with its music and its captions', () => {
      const music = edl.music;
      const audio = edl.assets.find((asset) => asset.kind === 'audio');
      expect(music && audio).toBeTruthy();
      if (!music || !audio) return;
      const withMusic: Project = {
        ...videoOnly,
        assets: [...videoOnly.assets, audio],
        // What an older build stored when music was added with no kesit: a 0.1 s selection.
        music: { ...music, sourceInUs: 0, sourceOutUs: 100_000, timelineStartUs: 0, fadeInUs: 0, fadeOutUs: 0 },
        captionTracks: [
          {
            trackId: 't_1',
            origin: 'manual',
            timeBase: 'source',
            assetId: 'a_video_001',
            language: 'tr',
            style: { preset: 'box', position: 'bottom', size: 'medium' },
            cues: [{ cueId: 'q_1', startUs: 0, endUs: US_PER_SECOND, text: 'Merhaba' }],
          },
        ],
      };
      const parsed = parseRecord(JSON.parse(JSON.stringify(createRecord('p', 'Tatil', withMusic, []))));
      expect(parsed).toMatchObject({ ok: true });
      if (!parsed.ok) return;
      expect(parsed.record.edl.music?.sourceOutUs).toBe(100_000);
      expect(parsed.record.edl.captionTracks[0]?.cues).toHaveLength(1);

      // That record is the one the music repair was written for (ADR-034 "müzik
      // videonun tamamının altında"); before this fix it never reached the repair,
      // because the record itself was refused.
      expect(isLegacyMusicStub(parsed.record.edl)).toBe(true);
      const video = videoOnly.assets[0];
      const healed = healLegacyMusic(parsed.record.edl);
      expect(healed.music?.sourceInUs).toBe(0);
      expect(healed.music?.sourceOutUs).toBe(Math.min(audio.durationUs, video?.durationUs ?? 0));
      // And what the repair gives is itself a record that opens again.
      expect(parseRecord(JSON.parse(JSON.stringify(createRecord('p', 'Tatil', healed, []))))).toMatchObject({ ok: true });
    });

    it('opens again when only the name was typed', () => {
      const empty: Project = { ...videoOnly, assets: [] };
      expect(parseRecord(JSON.parse(JSON.stringify(createRecord('p', 'Tatil', empty, []))))).toMatchObject({
        ok: true,
        record: { title: 'Tatil' },
      });
    });

    it('is still refused for every other broken rule', () => {
      const cases: Array<[unknown, string]> = [
        [{ ...videoOnly, clips: undefined }, 'missing_field'],
        [{ ...videoOnly, clips: 'none' }, 'missing_field'],
        [{ ...videoOnly, extra: true }, 'unknown_field'],
        [{ ...videoOnly, schemaVersion: 0 }, 'schema_version_unsupported'],
        [{ ...videoOnly, schemaVersion: '5' }, 'schema_version_unsupported'],
        [{ ...videoOnly, music: { ...edl.music, assetId: 'a_missing' } }, 'asset_unknown'],
        [{ ...videoOnly, assets: [{ ...videoOnly.assets[0], durationUs: 0 }] }, 'asset_duration_invalid'],
        [{ ...videoOnly, enhance: { mode: 'everything' } }, 'enhance_invalid'],
      ];
      for (const [project, code] of cases) {
        expect(issueCodes(validateStoredProject(project)), code).toContain(code);
        const record = { ...createRecord('p', '', edl, []), edl: project };
        expect(parseRecord(JSON.parse(JSON.stringify(record)))).toMatchObject({ reason: 'edl_invalid' });
      }
    });

    it('differs from the export rules in nothing else', () => {
      expect(validateStoredProject(edl)).toEqual(validateProject(edl));
      const twice = { ...edl, clips: [edl.clips[0], { ...edl.clips[0], sourceOutUs: -1 }] };
      expect(issueCodes(validateStoredProject(twice))).toEqual(issueCodes(validateProject(twice)));
      expect(issueCodes(validateStoredProject(twice)).length).toBeGreaterThan(0);
      // Every shared fixture gets the same verdict from both, except the one about empty clips.
      const manifest = JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'edl', 'manifest.json'), 'utf8')) as {
        valid: Array<{ file: string }>;
        invalid: Array<{ file: string }>;
      };
      for (const { file } of [...manifest.valid, ...manifest.invalid]) {
        const fixture = JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'edl', file), 'utf8'));
        if (file === 'invalid/empty-clips.json') continue;
        expect(issueCodes(validateStoredProject(fixture)), file).toEqual(issueCodes(validateProject(fixture)));
      }
    });

    it('upgrades every older schema the same way', () => {
      for (const schemaVersion of [2, 3, 4]) {
        const loaded = loadStoredProject({ ...videoOnly, schemaVersion });
        expect(loaded.ok, `v${schemaVersion}`).toBe(true);
        if (loaded.ok) expect(loaded.project.schemaVersion).toBe(edl.schemaVersion);
      }
      // v1 had no caption list at all.
      const v1: Record<string, unknown> = { ...videoOnly, schemaVersion: 1 };
      delete v1.captionTracks;
      const loaded = loadStoredProject(v1);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.project).toMatchObject({ schemaVersion: edl.schemaVersion, clips: [], captionTracks: [] });
    });
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
