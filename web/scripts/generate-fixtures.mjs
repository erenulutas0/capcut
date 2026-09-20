/**
 * Regenerates `fixtures/edl/`. The JSON files are committed: Dart and Python
 * must later read the SAME bytes and reach the SAME verdict (doc 10).
 * Run with: node scripts/generate-fixtures.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'edl');
const S = 1_000_000;

const videoAsset = {
  assetId: 'a_video_001',
  kind: 'video',
  durationUs: 20 * S,
  displayWidth: 1080,
  displayHeight: 1920,
  hasAudio: true,
};

const musicAsset = { assetId: 'a_music_001', kind: 'audio', durationUs: 30 * S };

const coverView = { x: 0, y: 0, width: 1, height: 1, fit: 'cover' };

const exportSpec = {
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  shortEdge: 1080,
  fpsNum: 30,
  fpsDen: 1,
  colorMode: 'sdr_rec709',
  audioSampleRate: 48000,
};

const clip = (clipId, inS, outS, extra = {}) => ({
  clipId,
  assetId: 'a_video_001',
  sourceInUs: Math.round(inS * S),
  sourceOutUs: Math.round(outS * S),
  sourceGainDb: 0,
  muted: false,
  view: { ...coverView },
  ...extra,
});

const project = (patch = {}) => ({
  schemaVersion: 1,
  projectId: 'p_fixture_001',
  revision: 1,
  assets: [videoAsset],
  canvas: { aspect: '9:16', background: '#000000' },
  clips: [clip('c_001', 0, 4)],
  export: { ...exportSpec },
  ...patch,
});

/** The canonical doc-10 example: two ranges -> 10 s, music 5-15 s. */
const docExample = {
  schemaVersion: 1,
  projectId: 'p_example_001',
  revision: 3,
  assets: [videoAsset, musicAsset],
  canvas: { aspect: '9:16', background: '#000000' },
  clips: [clip('c_001', 0, 4), clip('c_002', 8, 14, { sourceGainDb: -6 })],
  music: {
    assetId: 'a_music_001',
    sourceInUs: 5 * S,
    sourceOutUs: 15 * S,
    timelineStartUs: 0,
    gainDb: -12,
    muted: false,
    fadeInUs: 250_000,
    fadeOutUs: 500_000,
  },
  export: { ...exportSpec },
};

const valid = {
  'single-clip': project(),
  'doc10-example': docExample,
  'repeated-source-range': project({
    clips: [clip('c_001', 2, 6), clip('c_002', 2, 6), clip('c_003', 10, 12)],
  }),
  'silent-source': project({
    assets: [{ ...videoAsset, hasAudio: false }],
    clips: [clip('c_001', 0, 5, { muted: true, sourceGainDb: -60 })],
  }),
  'delayed-music': project({
    assets: [videoAsset, musicAsset],
    clips: [clip('c_001', 0, 6), clip('c_002', 6, 12)],
    music: {
      assetId: 'a_music_001',
      sourceInUs: 5 * S,
      sourceOutUs: 15 * S,
      timelineStartUs: 2 * S,
      gainDb: -9,
      muted: false,
      fadeInUs: 250_000,
      fadeOutUs: 500_000,
    },
  }),
  'square-output': project({
    canvas: { aspect: '1:1', background: '#000000' },
    clips: [clip('c_001', 0, 3, { view: { x: 0, y: 0.25, width: 1, height: 0.5, fit: 'cover' } })],
  }),
  'contain-letterbox': project({
    canvas: { aspect: '16:9', background: '#101315' },
    clips: [clip('c_001', 1, 4, { view: { x: 0, y: 0, width: 1, height: 1, fit: 'contain' } })],
  }),
  'minimum-length-clip': project({ clips: [clip('c_001', 0, 0.1)] }),
};

const invalid = {
  'negative-time': [project({ clips: [clip('c_001', 0, 4, { sourceInUs: -1 })] }), ['time_not_safe_integer']],
  'reversed-range': [project({ clips: [clip('c_001', 6, 2)] }), ['range_reversed']],
  'unknown-asset': [
    project({ clips: [{ ...clip('c_001', 0, 4), assetId: 'a_video_999' }] }),
    ['asset_unknown'],
  ],
  'crop-overflow': [
    project({ clips: [clip('c_001', 0, 4, { view: { x: 0.5, y: 0, width: 0.8, height: 1, fit: 'cover' } })] }),
    ['view_out_of_bounds'],
  ],
  'range-out-of-source': [project({ clips: [clip('c_001', 15, 25)] }), ['range_out_of_source']],
  'clip-too-short': [project({ clips: [clip('c_001', 0, 0.05)] }), ['clip_too_short']],
  'output-duration-exceeds-policy': [
    project({
      assets: [{ ...videoAsset, durationUs: 400 * S }],
      clips: [clip('c_001', 0, 400)],
    }),
    ['output_duration_exceeds_policy'],
  ],
  'unsupported-codec-spec': [
    project({ export: { ...exportSpec, videoCodec: 'hevc' } }),
    ['export_spec_invalid'],
  ],
  'too-many-clips': [
    project({
      clips: Array.from({ length: 21 }, (_, i) =>
        clip(`c_${String(i + 1).padStart(3, '0')}`, 0, 0.5),
      ),
    }),
    ['clip_limit_exceeded'],
  ],
  'music-fade-overflow': [
    project({
      assets: [videoAsset, musicAsset],
      clips: [clip('c_001', 0, 8)],
      music: {
        assetId: 'a_music_001',
        sourceInUs: 0,
        sourceOutUs: 2 * S,
        timelineStartUs: 0,
        gainDb: -12,
        muted: false,
        fadeInUs: 1_500_000,
        fadeOutUs: 1_500_000,
      },
    }),
    ['fade_exceeds_selection'],
  ],
  'music-start-after-output': [
    project({
      assets: [videoAsset, musicAsset],
      clips: [clip('c_001', 0, 4)],
      music: {
        assetId: 'a_music_001',
        sourceInUs: 0,
        sourceOutUs: 5 * S,
        timelineStartUs: 9 * S,
        gainDb: -12,
        muted: false,
        fadeInUs: 0,
        fadeOutUs: 0,
      },
    }),
    ['music_start_after_output'],
  ],
  'music-wrong-asset-kind': [
    project({
      assets: [videoAsset],
      clips: [clip('c_001', 0, 4)],
      music: {
        assetId: 'a_video_001',
        sourceInUs: 0,
        sourceOutUs: 2 * S,
        timelineStartUs: 0,
        gainDb: -12,
        muted: false,
        fadeInUs: 0,
        fadeOutUs: 0,
      },
    }),
    ['asset_kind_mismatch'],
  ],
  'future-schema': [project({ schemaVersion: 2 }), ['schema_version_unsupported']],
  'unknown-top-level-field': [
    { ...project(), captions: [{ text: 'merhaba' }] },
    ['unknown_field'],
  ],
  'duplicate-asset-id': [
    project({ assets: [videoAsset, { ...videoAsset }] }),
    ['asset_id_duplicate'],
  ],
  'gain-out-of-range': [project({ clips: [clip('c_001', 0, 4, { sourceGainDb: 6 })] }), ['gain_out_of_range']],
  'empty-clips': [project({ clips: [] }), ['clips_empty']],
  'non-integer-time': [
    project({ clips: [{ ...clip('c_001', 0, 4), sourceOutUs: 4_000_000.5 }] }),
    ['time_not_safe_integer'],
  ],
};

rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, 'valid'), { recursive: true });
mkdirSync(join(root, 'invalid'), { recursive: true });

const manifest = { schemaVersion: 1, valid: [], invalid: [] };

for (const [name, value] of Object.entries(valid)) {
  writeFileSync(join(root, 'valid', `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  manifest.valid.push({ file: `valid/${name}.json` });
}
for (const [name, [value, codes]] of Object.entries(invalid)) {
  writeFileSync(join(root, 'invalid', `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  manifest.invalid.push({ file: `invalid/${name}.json`, expectedIssueCodes: codes });
}

writeFileSync(
  join(root, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  `fixtures: ${manifest.valid.length} valid, ${manifest.invalid.length} invalid -> ${root}`,
);
