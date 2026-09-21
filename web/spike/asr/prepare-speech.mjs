/**
 * Builds the rights-clean speech set for the on-device transcript spike.
 *
 *   node prepare-speech.mjs
 *
 * Source: Google FLEURS (CC-BY-4.0), Hugging Face `google/fleurs`, ungated.
 * The test-split tarballs are 290–464 MB each, so only the leading bytes are
 * fetched with an HTTP Range request; a gzip stream decompresses sequentially,
 * so the first complete WAV entries come out intact. Reference transcripts come
 * from the split's `test.tsv`. Noisy and negative clips are synthesised here
 * with ffmpeg. Nothing is uploaded anywhere; the folder is gitignored.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as zlibConstants, gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const speechDir = join(webRoot, 'tests', 'media', 'speech');
const poolDir = join(speechDir, '.pool');
const clipDir = join(speechDir, 'clips');

const DATASET = {
  repo: 'google/fleurs',
  revision: '70bb2e84b976b7e960aa89f1c648e09c59f894dd',
  license: 'CC-BY-4.0',
  url: 'https://huggingface.co/datasets/google/fleurs',
};
// Leading byte ranges of the test tarballs. ~600–1400 KB per float32 WAV, so
// this yields ~40 Turkish and ~35 English complete clips to choose from.
const RANGES = { tr_tr: 26_000_000, en_us: 16_000_000 };
const WANT = { tr: 12, en: 6 };

const SILENCE_DB = -35;

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr}`);
  }
  return r;
}

async function download(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, status: res.status };
}

/** Minimal ustar reader that stops at the first truncated entry. */
function tarEntries(tar) {
  const entries = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
    const size = parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const start = off + 512;
    const end = start + size;
    if (end > tar.length) break; // truncated: the range ended inside this file
    if (type === '0' || type === '\0') {
      entries.push({ name: prefix ? `${prefix}/${name}` : name, data: tar.subarray(start, end) });
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function wavDataBytes(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    }
    if (id === 'data') return { ...fmt, dataBytes: size };
    off += 8 + size + (size % 2);
  }
  return null;
}

function parseTsv(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, filename, raw, normalized, , numSamples, gender] = line.split('\t');
      return { id, filename, raw, normalized, numSamples: Number(numSamples), gender };
    });
}

function meanVolumeDb(input, extraArgs = []) {
  const r = sh('ffmpeg', ['-hide_banner', '-nostats', ...extraArgs, '-i', input, '-af', 'volumedetect', '-f', 'null', '-'], {
    allowFail: true,
  });
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  if (!m) throw new Error(`volumedetect gave no mean_volume for ${input}\n${r.stderr}`);
  return Number(m[1]);
}

function maxVolumeDb(input) {
  const r = sh('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-af', 'volumedetect', '-f', 'null', '-'], { allowFail: true });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : 0;
}

/** Silence boundaries relative to the clip's own peak (FLEURS levels vary by 40 dB). */
function silences(file) {
  const gain = -1 - maxVolumeDb(file);
  const r = sh(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', `volume=${gain.toFixed(2)}dB,silencedetect=n=${SILENCE_DB}dB:d=0.2`, '-f', 'null', '-'],
    { allowFail: true },
  );
  const out = [];
  let open = null;
  for (const line of r.stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (s) open = Number(s[1]);
    if (e) {
      out.push({ start: Math.max(0, open ?? 0), end: Number(e[1]) });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end: null });
  return out;
}

function durationS(file) {
  const r = sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(r.stdout.trim());
}

function toClip(input, out) {
  sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Scores a sentence for the Turkish "proper nouns, numbers, brands" wish. */
function interest(row) {
  let score = 0;
  if (/\d/.test(row.raw)) score += 2;
  const inner = row.raw.slice(1);
  if (/(^|\s)[A-ZÇĞİÖŞÜ]/.test(inner)) score += 1;
  return score;
}

async function fetchPool(config) {
  const dir = join(poolDir, config);
  const marker = join(dir, 'range.json');
  if (existsSync(marker)) {
    console.log(`  ${config}: pool already fetched`);
    return JSON.parse(readFileSync(marker, 'utf8'));
  }
  mkdirSync(dir, { recursive: true });
  const base = `https://huggingface.co/datasets/${DATASET.repo}/resolve/${DATASET.revision}/data/${config}`;
  const tsv = await download(`${base}/test.tsv`);
  writeFileSync(join(dir, 'test.tsv'), tsv.buf);
  const tarUrl = `${base}/audio/test.tar.gz`;
  const range = `bytes=0-${RANGES[config] - 1}`;
  console.log(`  ${config}: fetching ${range} of test.tar.gz`);
  const part = await download(tarUrl, { Range: range });
  if (part.status !== 206) throw new Error(`Range request not honoured for ${tarUrl} (status ${part.status})`);
  const tar = gunzipSync(part.buf, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
  const entries = tarEntries(tar).filter((e) => e.name.endsWith('.wav'));
  for (const e of entries) writeFileSync(join(dir, e.name.split('/').pop()), e.data);
  const info = {
    config,
    tsvUrl: `${base}/test.tsv`,
    tsvSha256: sha256(tsv.buf),
    tarUrl,
    range,
    bytesFetched: part.buf.length,
    completeWavs: entries.map((e) => e.name.split('/').pop()),
  };
  writeFileSync(marker, JSON.stringify(info, null, 2));
  console.log(`  ${config}: ${entries.length} complete WAV entries from ${part.buf.length} bytes`);
  return info;
}

function choose(config, lang, count, pool) {
  const rows = parseTsv(readFileSync(join(poolDir, config, 'test.tsv'), 'utf8'));
  const byFile = new Map(rows.map((r) => [r.filename, r]));
  const candidates = [];
  for (const name of pool.completeWavs) {
    const row = byFile.get(name);
    if (!row) continue;
    const buf = readFileSync(join(poolDir, config, name));
    const wav = wavDataBytes(buf);
    if (!wav || wav.sampleRate !== 16000 || wav.channels !== 1) continue;
    const bytesPerSample = wav.bits / 8;
    if (wav.dataBytes !== row.numSamples * bytesPerSample) continue; // truncated or mismatched
    const dur = row.numSamples / 16000;
    if (dur < 4 || dur > 20) continue;
    candidates.push({ row, name, dur, score: interest(row) });
  }
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const seen = new Set();
  const picked = [];
  for (const c of candidates) {
    if (seen.has(c.row.id)) continue; // one speaker per sentence
    seen.add(c.row.id);
    picked.push(c);
    if (picked.length === count) break;
  }
  if (picked.length < count) throw new Error(`${config}: only ${picked.length} usable clips, wanted ${count}`);
  return picked.map((c, i) => ({
    id: `${lang}-${String(i + 1).padStart(2, '0')}`,
    lang,
    kind: 'clean',
    source: { dataset: 'google/fleurs', config, split: 'test', sentenceId: c.row.id, file: c.name, gender: c.row.gender },
    reference: { raw: c.row.raw, normalized: c.row.normalized },
    poolFile: join(poolDir, config, c.name),
  }));
}

function mixNoise(clip, out, noiseInput, noiseArgs, snrDb, seed) {
  const speech = meanVolumeDb(clip);
  const noise = meanVolumeDb(noiseInput, noiseArgs);
  const gain = speech - snrDb - noise;
  // Both inputs get 6 dB of headroom (SNR unchanged) so the sum cannot clip:
  // several FLEURS clips peak at 0 dBFS.
  const headroomDb = -6;
  sh('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', clip,
    ...noiseArgs, '-i', noiseInput,
    '-filter_complex', `[0:a]volume=${headroomDb}dB[s];[1:a]volume=${(gain + headroomDb).toFixed(2)}dB[n];[s][n]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '[a]', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out,
  ]);
  return { speechMeanDb: speech, noiseMeanDb: noise, noiseGainDb: gain, headroomDb, snrDb, seed, note: 'SNR from whole-clip mean volumes (pauses included)' };
}

async function main() {
  mkdirSync(clipDir, { recursive: true });
  console.log('FLEURS pool');
  const pools = { tr_tr: await fetchPool('tr_tr'), en_us: await fetchPool('en_us') };

  const clean = [...choose('tr_tr', 'tr', WANT.tr, pools.tr_tr), ...choose('en_us', 'en', WANT.en, pools.en_us)];
  const clips = [];
  for (const c of clean) {
    const file = `${c.id}.wav`;
    toClip(c.poolFile, join(clipDir, file));
    clips.push({ ...c, file, poolFile: undefined });
  }

  // Synthetic "music": three-note chords moving every two seconds with a
  // 4 Hz tremolo. Not a real recording, so no rights question.
  const music = join(poolDir, 'music-30s.wav');
  const musicExpr =
    '0.25*(sin(2*PI*(220+55*mod(floor(t/2),4))*t)+sin(2*PI*(277+69*mod(floor(t/2),4))*t)+sin(2*PI*(330+82*mod(floor(t/2),4))*t))*(0.6+0.4*sin(2*PI*4*t))';
  sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc='${musicExpr}':s=16000:d=30`, '-ac', '1', '-c:a', 'pcm_s16le', music]);
  const pinkSrc = (seed, d) => `anoisesrc=c=pink:r=16000:a=0.3:d=${d}:s=${seed}`;

  const noisy = [
    { id: 'noisy-01', from: 'tr-01', kind: 'noisy', noise: 'pink', snrDb: 10 },
    { id: 'noisy-02', from: 'tr-02', kind: 'noisy', noise: 'pink', snrDb: 5 },
    { id: 'noisy-03', from: 'tr-03', kind: 'noisy', noise: 'music', snrDb: 5 },
    // en-01 is a very quiet FLEURS recording (peak −42 dBFS); en-02 is a normal one.
    { id: 'noisy-04', from: 'en-02', kind: 'noisy', noise: 'music', snrDb: 10 },
  ];
  for (const n of noisy) {
    const base = clips.find((c) => c.id === n.from);
    const src = join(clipDir, base.file);
    const dur = durationS(src);
    const file = `${n.id}.wav`;
    const mix =
      n.noise === 'pink'
        ? mixNoise(src, join(clipDir, file), pinkSrc(42, Math.ceil(dur) + 1), ['-f', 'lavfi'], n.snrDb, 42)
        : mixNoise(src, join(clipDir, file), music, [], n.snrDb, null);
    clips.push({
      id: n.id,
      lang: base.lang,
      kind: 'noisy',
      file,
      derivedFrom: base.id,
      noise: { type: n.noise, ...mix },
      reference: base.reference,
      source: base.source,
    });
  }

  const negatives = [
    { id: 'neg-01', label: 'digital silence 15 s', src: 'anullsrc=r=16000:cl=mono:d=15' },
    { id: 'neg-02', label: 'room tone: pink noise at -55 dBFS, 15 s', src: `${pinkSrc(7, 15)},volume=-55dB` },
    { id: 'neg-03', label: 'synthetic music only, 15 s', src: null },
  ];
  for (const n of negatives) {
    const file = `${n.id}.wav`;
    if (n.src) {
      sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', n.src, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', join(clipDir, file)]);
    } else {
      sh('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', music, '-t', '15', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', join(clipDir, file)]);
    }
    clips.push({ id: n.id, lang: 'tr', kind: 'negative', file, label: n.label, reference: { raw: '', normalized: '' } });
  }

  for (const c of clips) {
    const path = join(clipDir, c.file);
    c.durationS = durationS(path);
    c.peakDbfs = maxVolumeDb(path);
    c.silences = c.kind === 'negative' ? [] : silences(path);
    c.sha256 = sha256(readFileSync(path));
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    dataset: DATASET,
    pools,
    silenceDetect: { thresholdDb: SILENCE_DB, minDurationS: 0.2, note: 'threshold applied after peak-normalising the clip to -1 dBFS' },
    clips,
  };
  writeFileSync(join(speechDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const lines = [
    '# Speech fixtures for the on-device transcript spike (ADR-017)',
    '',
    'Local only (gitignored). Nothing here is user media. Regenerate with `node web/spike/asr/prepare-speech.mjs`.',
    '',
    '## Google FLEURS',
    '',
    `- URL: ${DATASET.url} (Hugging Face dataset repo \`${DATASET.repo}\`, revision \`${DATASET.revision}\`, ungated, no login)`,
    `- License: ${DATASET.license} (dataset card: "All datasets are licensed under the Creative Commons license (CC-BY)")`,
    '- Citation: Conneau et al., "FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech", 2022.',
    '- What was taken: only the leading bytes of the test-split audio tarballs (HTTP Range request) plus the test-split transcript TSV:',
    ...Object.values(pools).map(
      (p) => `  - \`${p.config}\`: ${p.tarUrl} (${p.range}, ${p.bytesFetched} bytes → ${p.completeWavs.length} complete WAV entries) and ${p.tsvUrl} (sha256 ${p.tsvSha256})`,
    ),
    `- Clips used: ${clips.filter((c) => c.kind === 'clean').length} clean (${WANT.tr} tr_tr, ${WANT.en} en_us), each a distinct FLEURS sentence, 16 kHz mono, re-encoded to 16-bit PCM WAV. Reference text is the FLEURS \`transcription\` (normalised) column; the \`raw_transcription\` column is kept in \`manifest.json\` too.`,
    '',
    '## Derived clips (made here with ffmpeg)',
    '',
    ...clips
      .filter((c) => c.kind === 'noisy')
      .map((c) => `- \`${c.file}\`: \`${c.derivedFrom}\` + ${c.noise.type === 'pink' ? 'pink noise (anoisesrc)' : 'synthetic chord music (aevalsrc)'} at SNR ${c.noise.snrDb} dB (mean-volume based).`),
    ...clips.filter((c) => c.kind === 'negative').map((c) => `- \`${c.file}\`: ${c.label} (negative: the correct transcript is empty).`),
    '',
    '## Not used',
    '',
    '- Mozilla Common Voice: gated behind a login/terms click on Hugging Face; skipped.',
    '- Code-switched Turkish/English speech: no rights-clean, ungated corpus found; skipped (reported as not measured).',
    '- Multi-speaker recordings: none in scope of FLEURS single-sentence clips; skipped.',
    '',
    '| id | lang | kind | seconds | FLEURS file | reference (raw) |',
    '|---|---|---|---|---|---|',
    ...clips.map(
      (c) => `| ${c.id} | ${c.lang} | ${c.kind} | ${c.durationS.toFixed(2)} | ${c.source?.file ?? '—'} | ${(c.reference.raw || '(empty)').replace(/\|/g, '\\|')} |`,
    ),
    '',
  ];
  writeFileSync(join(speechDir, 'SOURCES.md'), lines.join('\n'));
  console.log(`\n${clips.length} clips → ${clipDir}`);
  for (const c of clips) console.log(`  ${c.id.padEnd(9)} ${c.lang} ${c.kind.padEnd(8)} ${c.durationS.toFixed(1).padStart(5)} s  ${(c.reference.raw || c.label).slice(0, 70)}`);
}

await main();
