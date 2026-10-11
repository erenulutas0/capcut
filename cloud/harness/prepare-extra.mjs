/**
 * Builds the clips of the cloud measurement set that the on-device sets
 * (ADR-036) do not have: read Japanese, non-read Turkish, and exactly two
 * people talking over each other.
 *
 *   node cloud/harness/prepare-extra.mjs
 *
 * Run AFTER `node web/spike/asr/prepare-english.mjs` (the two-speaker clip is
 * cut from that script's LibriSpeech pool). Nothing is uploaded anywhere; only
 * plain data is downloaded (audio, text), from the datasets' own hosts, without
 * a login. Only the LEADING bytes of the two tarballs are fetched (an HTTP
 * Range request; a gzip stream decompresses from its start, so the first
 * complete entries come out intact) — the same way `prepare-speech.mjs` does.
 *
 * Sources
 *  - Google FLEURS `ja_jp`, test split (CC BY 4.0), huggingface.co/datasets/google/fleurs
 *    (ungated): read sentences, reference = the dataset's `raw_transcription`.
 *  - MediaSpeech Turkish, OpenSLR SLR108 (CC BY 4.0), openslr.org/108: short
 *    segments of Turkish media (news / talk) speech from YouTube, manually
 *    transcribed. NOT read aloud — but NOT a two-way conversation either.
 *  - LibriSpeech test-clean + LibriSpeech Alignments (CC BY 4.0): two readers
 *    laid over each other with a known overlap; the word times and the speaker
 *    of every word are therefore exact.
 *
 * Writes web/tests/media/speech/cloud/*.wav (16 kHz mono 16-bit) and
 * web/tests/media/speech/manifest-cloud.json — both gitignored.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as zlibConstants, gunzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const speechDir = join(repoRoot, 'web', 'tests', 'media', 'speech');
const poolDir = join(speechDir, '.pool', 'cloud');
const lsDir = join(speechDir, '.pool', 'librispeech');
const outDir = join(speechDir, 'cloud');
const RATE = 16000;

const FLEURS = {
  dataset: 'Google FLEURS',
  license: 'CC BY 4.0',
  page: 'https://huggingface.co/datasets/google/fleurs',
  revision: '70bb2e84b976b7e960aa89f1c648e09c59f894dd',
  config: 'ja_jp',
  split: 'test',
  rangeBytes: 16_000_000,
  sentences: 10,
};
const MEDIASPEECH = {
  dataset: 'MediaSpeech (OpenSLR SLR108), Turkish',
  license: 'CC BY 4.0',
  page: 'https://www.openslr.org/108/',
  url: 'https://www.openslr.org/resources/108/TR.tgz',
  rangeBytes: 80_000_000,
  targetS: 300,
};
/** Two LibriSpeech test-clean readers (XX. */
const OVERLAP = { speakers: [1089, 121], perSpeaker: 10, overlapS: 1.5, license: 'CC BY 4.0' };
const PAUSE_S = 0.8;

function sh(cmd, argv) {
  const r = spawnSync(cmd, argv, { maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed:\n${r.stderr?.toString()}`);
  return r;
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const round3 = (value) => Number(value.toFixed(3));
const seconds = (s) => Math.round(s * RATE);

const downloads = [];
/** Fetches (once) a whole small file or the leading `rangeBytes` of a large one. */
async function fetchTo(url, dest, note, rangeBytes = null) {
  const meta = `${dest}.download.json`;
  if (!existsSync(dest) || !existsSync(meta)) {
    const headers = { 'User-Agent': 'LiloCutCloudMeasure/0.1 (local test media) node' };
    if (rangeBytes) headers.Range = `bytes=0-${rangeBytes - 1}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    if (rangeBytes && res.status !== 206) throw new Error(`Range request not honoured for ${url} (status ${res.status}); refusing to download the whole archive`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    writeFileSync(meta, JSON.stringify({ url, range: rangeBytes ? `bytes=0-${rangeBytes - 1}` : null, bytes: buf.length, sha256: sha256(buf), fetchedAt: new Date().toISOString(), ...note }, null, 1));
    console.log(`prepare-extra: downloaded ${url}${rangeBytes ? ` (first ${buf.length} bytes)` : ''}`);
  }
  downloads.push(JSON.parse(readFileSync(meta, 'utf8')));
  return readFileSync(dest);
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
    if (start + size > tar.length) break;
    if (type === '0' || type === '\0') entries.push({ name: prefix ? `${prefix}/${name}` : name, data: tar.subarray(start, start + size) });
    off = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}
const leadingEntries = (gz) => tarEntries(gunzipSync(gz, { finishFlush: zlibConstants.Z_SYNC_FLUSH }));
const baseName = (name) => name.split('/').pop();
/** Only plain file names made of letters, digits, dot, dash and underscore are written to disk. */
const safeName = (name) => /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith('.');

function decode(input) {
  const r = sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)).slice();
}
function writeWav(file, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const buf = Buffer.concat([header, data]);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return sha256(buf);
}
function probeDurationS(file) {
  return Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString().trim());
}
const meanPower = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += x[i] * x[i];
  return s / Math.max(1, x.length);
};
const atLevel = (x, levelDb) => {
  const k = 10 ** ((levelDb - 10 * Math.log10(Math.max(meanPower(x), 1e-12))) / 20);
  return x.map((v) => v * k);
};
/** Parts one after another with `PAUSE_S` of digital silence between; returns the samples and where each part sits. */
function join_(parts) {
  const pause = seconds(PAUSE_S);
  const total = parts.reduce((n, p) => n + p.length, 0) + pause * (parts.length - 1);
  const out = new Float32Array(total);
  const at = [];
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    at.push({ start: round3(off / RATE), end: round3((off + p.length) / RATE) });
    off += p.length + pause;
  }
  return { samples: out, at };
}

const clips = [];
function add(clip, samples) {
  const file = join(outDir, `${clip.id}.wav`);
  const hash = writeWav(file, samples);
  // The length is MEASURED on the written file (ffprobe), not computed.
  clips.push({ ...clip, file: `cloud/${clip.id}.wav`, durationS: round3(probeDurationS(file)), sha256: hash });
  console.log(`prepare-extra: ${clip.id} ${probeDurationS(file).toFixed(1)} s`);
}

// ---------------------------------------------------------------- Japanese, read (FLEURS)
async function japaneseRead() {
  const base = `https://huggingface.co/datasets/google/fleurs/resolve/${FLEURS.revision}/data/${FLEURS.config}`;
  const dir = join(poolDir, `fleurs-${FLEURS.config}`);
  const note = { dataset: FLEURS.dataset, license: FLEURS.license };
  const tsv = (await fetchTo(`${base}/${FLEURS.split}.tsv`, join(dir, `${FLEURS.split}.tsv`), note)).toString('utf8');
  const gz = await fetchTo(`${base}/audio/${FLEURS.split}.tar.gz`, join(dir, `${FLEURS.split}.leading.tar.gz`), note, FLEURS.rangeBytes);
  const rows = new Map();
  for (const line of tsv.split(/\r?\n/).filter(Boolean)) {
    const [id, filename, raw, normalized, , numSamples, gender] = line.split('\t');
    rows.set(filename, { id, filename, raw, normalized, numSamples: Number(numSamples), gender });
  }
  const picked = [];
  const seen = new Set();
  for (const entry of leadingEntries(gz).filter((e) => e.name.endsWith('.wav')).sort((a, b) => baseName(a.name).localeCompare(baseName(b.name)))) {
    const name = baseName(entry.name);
    const row = rows.get(name);
    if (!row || !safeName(name) || seen.has(row.id)) continue; // one reading per sentence
    const durationS = row.numSamples / RATE;
    if (durationS < 4 || durationS > 20) continue;
    const file = join(dir, name);
    writeFileSync(file, entry.data);
    const samples = decode(file);
    if (Math.abs(samples.length - row.numSamples) > RATE / 10) continue; // not the whole recording
    seen.add(row.id);
    picked.push({ row, samples });
    if (picked.length === FLEURS.sentences) break;
  }
  if (picked.length < FLEURS.sentences) throw new Error(`FLEURS ${FLEURS.config}: only ${picked.length} usable clips in the leading ${FLEURS.rangeBytes} bytes`);
  // FLEURS levels differ by tens of dB between recordings; every sentence is brought to the same mean level.
  const { samples, at } = join_(picked.map((p) => atLevel(p.samples, -26)));
  add(
    {
      id: 'ja-read',
      lang: 'ja',
      kind: 'speech',
      note: `${picked.length} read Japanese sentences (FLEURS ja_jp test), each levelled to -26 dBFS mean, ${PAUSE_S} s of silence between`,
      reference: { raw: picked.map((p) => p.row.raw).join(' '), normalized: picked.map((p) => p.row.normalized).join(' ') },
      words: null,
      expectedSpeakers: null,
      parts: picked.map((p, i) => ({ ...at[i], sentenceId: p.row.id, file: p.row.filename, gender: p.row.gender, raw: p.row.raw })),
      source: { dataset: FLEURS.dataset, license: FLEURS.license, page: FLEURS.page, revision: FLEURS.revision, config: FLEURS.config, split: FLEURS.split, files: picked.map((p) => p.row.filename), sentenceIds: picked.map((p) => p.row.id) },
    },
    samples,
  );
}

// ---------------------------------------------------------------- Turkish, not read (MediaSpeech)
async function turkishMedia() {
  const dir = join(poolDir, 'mediaspeech-tr');
  const gz = await fetchTo(MEDIASPEECH.url, join(dir, 'TR.leading.tgz'), { dataset: MEDIASPEECH.dataset, license: MEDIASPEECH.license }, MEDIASPEECH.rangeBytes);
  const entries = leadingEntries(gz);
  const text = new Map(entries.filter((e) => e.name.endsWith('.txt')).map((e) => [baseName(e.name).replace(/\.txt$/, ''), e.data.toString('utf8').trim()]));
  const picked = [];
  let totalS = 0;
  for (const entry of entries.filter((e) => e.name.endsWith('.flac')).sort((a, b) => baseName(a.name).localeCompare(baseName(b.name)))) {
    const name = baseName(entry.name);
    const reference = text.get(name.replace(/\.flac$/, ''));
    if (!reference || !safeName(name)) continue;
    const file = join(dir, name);
    writeFileSync(file, entry.data);
    const samples = decode(file);
    picked.push({ name, reference, samples });
    totalS += samples.length / RATE + PAUSE_S;
    if (totalS >= MEDIASPEECH.targetS) break;
  }
  if (totalS < MEDIASPEECH.targetS) throw new Error(`MediaSpeech TR: only ${totalS.toFixed(0)} s in the leading ${MEDIASPEECH.rangeBytes} bytes`);
  const { samples, at } = join_(picked.map((p) => p.samples));
  add(
    {
      id: 'tr-media',
      lang: 'tr',
      kind: 'speech',
      note: `${picked.length} segments of Turkish media speech (MediaSpeech), in file-name order, ${PAUSE_S} s of silence between. Unrelated segments from different programmes: spontaneous / broadcast speech, NOT one two-way conversation. How many different people speak is not known.`,
      reference: { raw: picked.map((p) => p.reference).join(' ') },
      words: null,
      expectedSpeakers: null,
      parts: picked.map((p, i) => ({ ...at[i], file: p.name, raw: p.reference })),
      source: { dataset: MEDIASPEECH.dataset, license: MEDIASPEECH.license, page: MEDIASPEECH.page, archive: MEDIASPEECH.url, files: picked.map((p) => p.name) },
    },
    samples,
  );
}

// ---------------------------------------------------------------- two speakers over each other (LibriSpeech)
function parseTextGrid(text) {
  const tierAt = text.search(/name = "words"/);
  const next = text.indexOf('item [', tierAt);
  const tier = text.slice(tierAt, next < 0 ? undefined : next);
  const words = [];
  const re = /xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "([^"]*)"/g;
  let m;
  while ((m = re.exec(tier))) {
    const w = m[3].trim();
    if (w && w !== 'sil' && w !== 'sp' && w !== '<unk>' && w !== 'spn') words.push({ w: w.toLowerCase(), s: Number(m[1]), e: Number(m[2]) });
  }
  return words;
}
function utterances(speaker, count) {
  const speakerDir = join(lsDir, 'LibriSpeech', 'test-clean', String(speaker));
  if (!existsSync(speakerDir)) throw new Error(`no LibriSpeech pool at ${speakerDir}: run node web/spike/asr/prepare-english.mjs first`);
  const chapter = readdirSync(speakerDir).sort()[0];
  const dir = join(speakerDir, chapter);
  const lines = readFileSync(join(dir, `${speaker}-${chapter}.trans.txt`), 'utf8').split(/\r?\n/).filter(Boolean).slice(0, count);
  return lines.map((line) => {
    const id = line.slice(0, line.indexOf(' '));
    const grid = join(lsDir, 'alignments', 'test-clean', String(speaker), chapter, `${id}.TextGrid`);
    return { id, speaker: String(speaker), samples: atLevel(decode(join(dir, `${id}.flac`)), -26), words: parseTextGrid(readFileSync(grid, 'utf8')) };
  });
}
function twoSpeakerOverlap() {
  const [a, b] = OVERLAP.speakers.map((speaker) => utterances(speaker, OVERLAP.perSpeaker));
  const turns = [];
  for (let i = 0; i < OVERLAP.perSpeaker; i += 1) turns.push(a[i], b[i]);
  // Each turn starts `overlapS` before the one before it ends: every change of speaker is talked over.
  const placed = [];
  let end = 0;
  for (const turn of turns) {
    const start = placed.length === 0 ? 0 : Math.max(placed[placed.length - 1].start + RATE, end - seconds(OVERLAP.overlapS));
    placed.push({ turn, start });
    end = Math.max(end, start + turn.samples.length);
  }
  const samples = new Float32Array(end);
  const words = [];
  const turnList = [];
  for (const { turn, start } of placed) {
    for (let i = 0; i < turn.samples.length; i += 1) samples[start + i] += turn.samples[i] * 0.5;
    const offset = start / RATE;
    for (const w of turn.words) words.push({ w: w.w, s: round3(w.s + offset), e: round3(w.e + offset), speaker: turn.speaker });
    turnList.push({ utterance: turn.id, speaker: turn.speaker, start: round3(offset), end: round3((start + turn.samples.length) / RATE) });
  }
  words.sort((x, y) => x.s - y.s || x.e - y.e);
  const overlaps = [];
  for (let i = 1; i < turnList.length; i += 1) {
    const from = turnList[i].start;
    const to = Math.min(turnList[i - 1].end, turnList[i].end);
    if (to > from) overlaps.push({ start: from, end: round3(to) });
  }
  const inOverlap = words.filter((w) => overlaps.some((o) => (w.s + w.e) / 2 >= o.start && (w.s + w.e) / 2 < o.end)).length;
  add(
    {
      id: 'overlap-2',
      lang: 'en',
      kind: 'speech',
      note: `two LibriSpeech readers (${OVERLAP.speakers.join(', ')}) taking turns, every turn starting ${OVERLAP.overlapS} s before the other stops; both levelled to -26 dBFS mean. Synthetic overlap of READ speech: the reference words are in order of their start time, so inside an overlap the order of the two voices' words is a convention — ${inOverlap} of ${words.length} words lie in an overlap.`,
      reference: { raw: words.map((w) => w.w).join(' ') },
      words,
      expectedSpeakers: 2,
      turns: turnList,
      overlaps,
      wordsInOverlap: inOverlap,
      source: { dataset: 'LibriSpeech test-clean + LibriSpeech Alignments', license: OVERLAP.license, page: 'https://www.openslr.org/12/ ; https://zenodo.org/records/2619474', speakers: OVERLAP.speakers, utterances: turnList.map((t) => t.utterance) },
    },
    samples,
  );
}

// --only=ja-read,tr-media,overlap-2 rebuilds only those clips; the others stay in the manifest as they were.
const onlyArg = process.argv.slice(2).find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const wanted = (id) => !only || only.has(id);
mkdirSync(outDir, { recursive: true });
if (wanted('ja-read')) await japaneseRead();
if (wanted('tr-media')) await turkishMedia();
if (wanted('overlap-2')) twoSpeakerOverlap();
const manifestFile = join(speechDir, 'manifest-cloud.json');
const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { clips: [], downloads: [] };
const merged = {
  updatedAt: new Date().toISOString(),
  script: 'cloud/harness/prepare-extra.mjs',
  downloads: [...previous.downloads.filter((d) => !downloads.some((n) => n.url === d.url)), ...downloads],
  clips: [...previous.clips.filter((clip) => !clips.some((n) => n.id === clip.id)), ...clips],
};
writeFileSync(manifestFile, `${JSON.stringify(merged, null, 1)}
`);
console.log(`prepare-extra: ${clips.length} clips built; ${merged.clips.length} in ${manifestFile}`);
for (const d of merged.downloads) console.log(`  ${d.url} ${d.range ?? 'whole file'} ${d.bytes} bytes sha256 ${d.sha256.slice(0, 16)}… ${d.license} fetched ${d.fetchedAt}`);
