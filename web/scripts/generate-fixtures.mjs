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

const LF = String.fromCharCode(10);

const captionTrack = (cues, patch = {}) => ({
  trackId: 't_001',
  origin: 'manual',
  timeBase: 'output',
  language: 'tr',
  style: { preset: 'box', position: 'bottom', size: 'medium' },
  cues,
  ...patch,
});

const cue = (cueId, inS, outS, text) => ({
  cueId,
  startUs: Math.round(inS * S),
  endUs: Math.round(outS * S),
  text,
});

const project = (patch = {}) => ({
  schemaVersion: 2,
  projectId: 'p_fixture_001',
  revision: 1,
  assets: [videoAsset],
  canvas: { aspect: '9:16', background: '#000000' },
  clips: [clip('c_001', 0, 4)],
  export: { ...exportSpec },
  captionTracks: [],
  ...patch,
});

/** The canonical doc-10 example: two ranges -> 10 s, music 5-15 s. */
const docExample = {
  schemaVersion: 2,
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
  captionTracks: [
    captionTrack([
      cue('q_001', 0.5, 3, 'İlk an: güneş doğuyor'),
      cue('q_002', 4.5, 8, `İkinci an${LF}iki satır`),
    ]),
  ],
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
  // A cue may outlive the current output; the render plan cuts it (ADR-015).
  'caption-past-output': project({
    captionTracks: [captionTrack([cue('q_001', 3, 6, 'Sonuna kadar')])],
  }),
  // Source-anchored (ADR-016): cue times are on the video file's clock, and
  // may cover parts no moment uses (here 12-19 s).
  'caption-source-anchored': project({
    clips: [clip('c_001', 8, 14), clip('c_002', 0, 4)],
    captionTracks: [
      captionTrack(
        [cue('q_001', 1, 3, 'Baştaki an'), cue('q_002', 9, 13, 'Sonradan eklenen an'), cue('q_003', 15, 19, 'Kullanılmayan')],
        { timeBase: 'source', assetId: 'a_video_001', origin: 'imported' },
      ),
    ],
  }),
  'caption-outline-top-en': project({
    captionTracks: [
      captionTrack([cue('q_001', 0, 2, 'Hello there')], {
        language: 'en',
        style: { preset: 'outline', position: 'top', size: 'large' },
      }),
    ],
  }),
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
  'future-schema': [project({ schemaVersion: 3 }), ['schema_version_unsupported']],
  'missing-caption-tracks': [
    (() => {
      const { captionTracks: _drop, ...rest } = project();
      return rest;
    })(),
    ['missing_field'],
  ],
  'caption-overlap': [
    project({ captionTracks: [captionTrack([cue('q_001', 0, 2, 'bir'), cue('q_002', 1.5, 3, 'iki')])] }),
    ['caption_cue_overlap'],
  ],
  'caption-text-not-normalized': [
    project({ captionTracks: [captionTrack([cue('q_001', 0, 2, '  iki   boşluk ')])] }),
    ['caption_text_invalid'],
  ],
  'caption-text-too-long': [
    project({ captionTracks: [captionTrack([cue('q_001', 0, 2, 'a'.repeat(121))])] }),
    ['caption_text_invalid'],
  ],
  'caption-three-lines': [
    project({ captionTracks: [captionTrack([cue('q_001', 0, 2, ['bir', 'iki', 'üç'].join(LF))])] }),
    ['caption_text_invalid'],
  ],
  'caption-too-short': [
    project({ captionTracks: [captionTrack([cue('q_001', 0, 0.1, 'kısa')])] }),
    ['caption_cue_too_short'],
  ],
  'caption-unknown-style': [
    project({
      captionTracks: [
        captionTrack([cue('q_001', 0, 2, 'stil')], {
          style: { preset: 'karaoke', position: 'bottom', size: 'medium' },
        }),
      ],
    }),
    ['caption_style_invalid'],
  ],
  'caption-source-without-asset': [
    project({ captionTracks: [captionTrack([cue('q_001', 0, 2, 'kaynak')], { timeBase: 'source' })] }),
    ['id_invalid'],
  ],
  'caption-source-past-video': [
    project({
      captionTracks: [
        captionTrack([cue('q_001', 19, 21, 'taşan')], { timeBase: 'source', assetId: 'a_video_001' }),
      ],
    }),
    ['range_out_of_source'],
  ],
  'caption-source-unknown-asset': [
    project({
      captionTracks: [
        captionTrack([cue('q_001', 0, 2, 'yok')], { timeBase: 'source', assetId: 'a_video_999' }),
      ],
    }),
    ['asset_unknown'],
  ],
  'caption-output-with-asset': [
    project({ captionTracks: [captionTrack([cue('q_001', 0, 2, 'çıktı')], { assetId: 'a_video_001' })] }),
    ['caption_track_invalid'],
  ],
  'two-caption-tracks': [
    project({
      captionTracks: [
        captionTrack([cue('q_001', 0, 2, 'tr')]),
        captionTrack([cue('q_002', 0, 2, 'en')], { trackId: 't_002', language: 'en' }),
      ],
    }),
    ['caption_track_limit_exceeded'],
  ],
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
mkdirSync(join(root, 'legacy-v1'), { recursive: true });

const manifest = { schemaVersion: 2, valid: [], invalid: [], legacy: [] };

for (const [name, value] of Object.entries(valid)) {
  writeFileSync(join(root, 'valid', `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  manifest.valid.push({ file: `valid/${name}.json` });
}
// v1 recipes written by older builds. Readers migrate them (migration.ts);
// `expect` is the verdict AFTER migration.
const asV1 = (value) => {
  const { captionTracks: _drop, ...rest } = value;
  return { ...rest, schemaVersion: 1 };
};
const legacy = {
  'single-clip': [asV1(project()), 'valid'],
  'doc10-example': [asV1({ ...docExample, captionTracks: [] }), 'valid'],
  // A "v1" that carries v2 fields is not something any build wrote.
  'v1-with-captions': [{ ...asV1(project()), captionTracks: [] }, 'invalid'],
};
for (const [name, [value, expect]] of Object.entries(legacy)) {
  writeFileSync(join(root, 'legacy-v1', `${name}.json`), `${JSON.stringify(value, null, 2)}${LF}`);
  manifest.legacy.push({ file: `legacy-v1/${name}.json`, expect });
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
