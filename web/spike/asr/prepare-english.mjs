/**
 * Builds the October 2026 English set for the on-device transcript spike
 * (docs/spikes/2026-10-03-asr-on-device-english.md). Run after
 * `prepare-speech.mjs` (the September set is reused as-is).
 *
 *   node prepare-english.mjs
 *
 * Sources (all open, ungated; details and licences end up in
 * web/tests/media/speech/SOURCES.md):
 *  - LibriSpeech test-clean (CC-BY-4.0, openslr.org/12) — long read speech;
 *  - LibriSpeech Alignments (CC-BY-4.0, zenodo.org/records/2619474) — word
 *    start/end times from the Montreal Forced Aligner: the timing reference;
 *  - Google FLEURS en_us test (CC-BY-4.0) — punctuated, cased text with numbers;
 *  - three music recordings from Wikimedia Commons (CC0 / CC-BY-4.0).
 * Noise, room tone and silence are synthesised with ffmpeg. Nothing is
 * uploaded anywhere; the folder is gitignored.
 *
 * What it writes: speech/en/*.wav (16 kHz mono 16-bit) and
 * speech/manifest-en.json. Every clip carries what the correct answer is:
 * reference text, reference word times where they exist, the regions that
 * hold no speech, and the spans our own silence detector (ADR-018) would pass.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { constants as zlibConstants, gunzipSync } from 'node:zlib';

import { complement } from './segments.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(dirname(here));
const speechDir = join(webRoot, 'tests', 'media', 'speech');
const poolDir = join(speechDir, '.pool');
const lsDir = join(poolDir, 'librispeech');
const outDir = join(speechDir, 'en');
const RATE = 16000;

const LIBRISPEECH = {
  url: 'https://www.openslr.org/resources/12/test-clean.tar.gz',
  md5: '32fa31d27d2e1cad72775fee3f4849a9',
  license: 'CC-BY-4.0',
};
const ALIGNMENTS = {
  url: 'https://zenodo.org/api/records/2619474/files/librispeech_alignments.zip/content',
  md5: '2bab567d0ace651a4ba254e813629f46',
  license: 'CC-BY-4.0',
  doi: '10.5281/zenodo.2619474',
};
const FLEURS = {
  repo: 'google/fleurs',
  revision: '70bb2e84b976b7e960aa89f1c648e09c59f894dd',
  license: 'CC-BY-4.0',
  rangeBytes: 48_000_000,
};
const MUSIC = [
  {
    key: 'vlog',
    title: 'Kevin MacLeod — Scheming Weasel (faster)',
    license: 'CC-BY-4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Scheming_Weasel_(faster).wav',
    url: 'https://upload.wikimedia.org/wikipedia/commons/9/9e/Kevin_MacLeod_-_Scheming_Weasel_%28faster%29.wav',
    ext: 'wav',
  },
  {
    key: 'piano',
    title: 'Chopin — Nocturne Op. 15 no. 1 in F major',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Chopin_-_Nocturne_Op._15_no._1_in_F_major.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/56/Chopin_-_Nocturne_Op._15_no._1_in_F_major.ogg',
    ext: 'ogg',
  },
  {
    key: 'jazz',
    title: 'John Bartmann — Robot Gypsy Jazz',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:John_Bartmann_-_13_-_Robot_Gypsy_Jazz.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/1/11/John_Bartmann_-_13_-_Robot_Gypsy_Jazz.ogg',
    ext: 'ogg',
  },
];

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { maxBuffer: 1024 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr?.toString()}`);
  return r;
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/** Any audio (file or lavfi source) → Float32 mono 16 kHz. */
function decode(input, pre = [], post = []) {
  const r = sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...pre, '-i', input, ...post, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)).slice();
}
const lavfi = (src) => decode(src, ['-f', 'lavfi']);

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
  writeFileSync(file, buf);
  return sha256(buf);
}

function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const meanPower = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += x[i] * x[i];
  return s / Math.max(1, x.length);
};
const db = (p) => 10 * Math.log10(Math.max(p, 1e-12));
const gain = (x, gainDb) => x.map((v) => v * 10 ** (gainDb / 20));
const peakDb = (x) => {
  let p = 0;
  for (let i = 0; i < x.length; i += 1) p = Math.max(p, Math.abs(x[i]));
  return 20 * Math.log10(Math.max(p, 1e-9));
};
/** `bed` looped/cut to the length of `speech`. */
function fit(bed, length, from = 0) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = bed[(from + i) % bed.length];
  return out;
}
/** Speech + bed at a whole-clip SNR (mean power, pauses included — same definition as September). */
function mix(speech, bed, snrDb) {
  const g = db(meanPower(speech)) - snrDb - db(meanPower(bed));
  const headroom = 10 ** (-6 / 20);
  const k = 10 ** (g / 20);
  const out = new Float32Array(speech.length);
  for (let i = 0; i < speech.length; i += 1) out[i] = (speech[i] + bed[i] * k) * headroom;
  return { samples: out, bedGainDb: Number(g.toFixed(2)) };
}
/** Bed at an absolute mean level. */
const atLevel = (x, levelDb) => gain(x, levelDb - db(meanPower(x)));

// ---------------------------------------------------------------- downloads
async function fetchTo(url, dest, headers = {}) {
  if (existsSync(dest)) return readFileSync(dest);
  const res = await fetch(url, { headers: { 'User-Agent': 'clip-asr-spike/0.1 (local measurement)', ...headers } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf;
}

function tarEntries(tar) {
  const entries = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const size = parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const start = off + 512;
    if (start + size > tar.length) break;
    if (type === '0' || type === '\0') entries.push({ name, data: tar.subarray(start, start + size) });
    off = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

// ---------------------------------------------------------------- LibriSpeech
/** TextGrid "words" tier → [{ w, s, e }] (silences dropped). */
function parseTextGrid(text) {
  const tierAt = text.search(/name = "words"/);
  if (tierAt < 0) throw new Error('TextGrid without a words tier');
  const next = text.indexOf('item [', tierAt);
  const tier = text.slice(tierAt, next < 0 ? undefined : next);
  const words = [];
  const re = /xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "([^"]*)"/g;
  let m;
  while ((m = re.exec(tier))) {
    const w = m[3].trim();
    if (w && w !== 'sil' && w !== 'sp' && w !== '<unk>' && w !== 'spn') words.push({ w: w.toLowerCase(), s: Number(m[1]), e: Number(m[2]) });
    else if (w === '<unk>' || w === 'spn') words.push({ w: null, s: Number(m[1]), e: Number(m[2]) });
  }
  return words;
}

let alignmentIndex = null;
function alignmentFor(utt) {
  const [spk, chap] = utt.split('-');
  const dir = join(lsDir, 'alignments');
  if (!alignmentIndex) {
    if (!existsSync(join(dir, 'test-clean', '61'))) {
      // Only the test-clean part of the 623 MB archive is unpacked.
      mkdirSync(dir, { recursive: true });
      // bsdtar (ships with Windows 10+, and is `tar` on macOS) reads zip archives; GNU tar does not.
      const bsdtar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar';
      sh(bsdtar, ['-xf', join(lsDir, 'librispeech_alignments.zip'), '-C', dir, 'test-clean']);
    }
    alignmentIndex = new Map();
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith('.TextGrid')) alignmentIndex.set(e.name.replace('.TextGrid', ''), join(d, e.name));
      }
    };
    walk(dir);
  }
  const file = alignmentIndex.get(utt);
  if (!file) throw new Error(`no alignment for ${utt} (${spk}/${chap})`);
  return parseTextGrid(readFileSync(file, 'utf8'));
}

function chapterUtterances(spk, chap) {
  const dir = join(lsDir, 'LibriSpeech', 'test-clean', String(spk), String(chap));
  const trans = readFileSync(join(dir, `${spk}-${chap}.trans.txt`), 'utf8').split(/\r?\n/).filter(Boolean);
  return trans.map((line) => {
    const sp = line.indexOf(' ');
    const id = line.slice(0, sp);
    return { id, text: line.slice(sp + 1).toLowerCase(), flac: join(dir, `${id}.flac`) };
  });
}

/**
 * Consecutive utterances of the given chapters, in reading order, until
 * `targetS` is reached. Returns samples, text and word times on the new clock.
 */
function librispeechRun(chapters, targetS, skip = 0) {
  const parts = [];
  const words = [];
  const texts = [];
  const utts = [];
  let at = 0;
  outer: for (const [spk, chap] of chapters) {
    for (const u of chapterUtterances(spk, chap).slice(skip)) {
      const samples = decode(u.flac);
      const offset = at / RATE;
      const aligned = alignmentFor(u.id);
      for (const w of aligned) words.push({ w: w.w, s: Number((w.s + offset).toFixed(3)), e: Number((w.e + offset).toFixed(3)) });
      utts.push({ id: u.id, start: Number(offset.toFixed(3)), end: Number((offset + samples.length / RATE).toFixed(3)) });
      texts.push(u.text);
      parts.push(samples);
      at += samples.length;
      if (at / RATE >= targetS) break outer;
    }
    skip = 0;
  }
  return { samples: concat(parts), text: texts.join(' '), words, utts };
}

// ---------------------------------------------------------------- our own detector (ADR-018)
async function loadDetector() {
  const ts = (await import('typescript')).default;
  const source = readFileSync(join(webRoot, 'src', 'domain', 'silence.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  if (/from '\.\//.test(outputText)) throw new Error('silence.ts gained a runtime import');
  const dir = join(here, '.generated');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'silence.mjs');
  writeFileSync(target, outputText);
  return import(`${pathToFileURL(target).href}?${Date.now()}`);
}

/** 10 ms RMS envelope in dBFS, as `domain/loudness.ts` defines it. */
function envelope(samples) {
  const frame = RATE / 100;
  const n = Math.floor(samples.length / frame);
  const out = new Array(n);
  for (let k = 0; k < n; k += 1) {
    let sum = 0;
    for (let i = k * frame; i < (k + 1) * frame; i += 1) sum += samples[i] * samples[i];
    const ms = sum / frame;
    out[k] = ms > 0 ? Math.max(-120, 10 * Math.log10(ms)) : -120;
  }
  return out;
}

/**
 * What our detector would let through. It reports removable SILENCES; speech
 * is the rest. When it declines (`low_contrast`: music, noise, or nothing but
 * silence) there is no silence to remove, so everything passes — that is the
 * detector as it is. `ownAbs` adds the one rule a pre-filter would need on
 * top: a file whose loud level is under −45 dBFS has nothing to transcribe.
 */
function ownSpans(detector, samples) {
  const totalS = samples.length / RATE;
  const analysis = detector.findSilences({ startUs: 0, frameUs: 10_000, db: envelope(samples) }, detector.DEFAULT_SILENCE_PARAMS);
  const stats = { floorDb: Number(analysis.stats.floorDb.toFixed(1)), loudDb: Number(analysis.stats.loudDb.toFixed(1)), thresholdDb: Number(analysis.stats.thresholdDb.toFixed(1)) };
  const silences = analysis.ok ? analysis.suggestions.map((s) => ({ start: s.startUs / 1e6, end: s.endUs / 1e6 })) : [];
  const round = (list) => list.map((s) => ({ start: Number(s.start.toFixed(3)), end: Number(s.end.toFixed(3)) }));
  const spans = round(complement(silences, totalS));
  return {
    status: analysis.ok ? 'ok' : analysis.reason,
    stats,
    silences: round(silences),
    spans,
    spansAbs: stats.loudDb < -45 ? [] : spans,
  };
}

// ---------------------------------------------------------------- main
async function main() {
  mkdirSync(outDir, { recursive: true });
  const downloads = [];

  // LibriSpeech + alignments are fetched by hand-run curl in this spike (large files); verify what is on disk.
  const lsTar = join(lsDir, 'test-clean.tar.gz');
  const alZip = join(lsDir, 'librispeech_alignments.zip');
  if (!existsSync(lsTar)) await fetchTo(LIBRISPEECH.url, lsTar);
  if (!existsSync(alZip)) await fetchTo(ALIGNMENTS.url, alZip);
  for (const [file, meta] of [[lsTar, LIBRISPEECH], [alZip, ALIGNMENTS]]) {
    const buf = readFileSync(file);
    if (md5(buf) !== meta.md5) throw new Error(`${file}: md5 ${md5(buf)} ≠ published ${meta.md5}`);
    downloads.push({ name: file.split(/[\\/]/).pop(), url: meta.url, bytes: buf.length, md5: meta.md5, sha256: sha256(buf), license: meta.license });
  }
  if (!existsSync(join(lsDir, 'LibriSpeech'))) sh('tar', ['-xzf', lsTar, '-C', lsDir]);

  const music = {};
  for (const m of MUSIC) {
    const file = join(poolDir, 'music', `${m.key}.${m.ext}`);
    const buf = await fetchTo(m.url, file);
    downloads.push({ name: `${m.key}.${m.ext}`, url: m.url, page: m.page, title: m.title, bytes: buf.length, sha256: sha256(buf), license: m.license });
    music[m.key] = decode(file);
  }

  // FLEURS en_us, a longer leading range than September's (own pool folder: the September selection must not move).
  const fleursDir = join(poolDir, 'en_us_long');
  const base = `https://huggingface.co/datasets/${FLEURS.repo}/resolve/${FLEURS.revision}/data/en_us`;
  const tsv = (await fetchTo(`${base}/test.tsv`, join(fleursDir, 'test.tsv'))).toString('utf8');
  const part = await fetchTo(`${base}/audio/test.tar.gz`, join(fleursDir, 'test.part.tar.gz'), { Range: `bytes=0-${FLEURS.rangeBytes - 1}` });
  downloads.push({ name: 'fleurs en_us test.tar.gz (leading range)', url: `${base}/audio/test.tar.gz`, bytes: part.length, sha256: sha256(part), license: FLEURS.license });
  const fleursRows = new Map(
    tsv.split(/\r?\n/).filter(Boolean).map((line) => {
      const [id, filename, raw, , , numSamples] = line.split('\t');
      return [filename, { id, raw, numSamples: Number(numSamples) }];
    }),
  );
  const fleursWavs = tarEntries(gunzipSync(part, { finishFlush: zlibConstants.Z_SYNC_FLUSH })).filter((e) => e.name.endsWith('.wav'));

  const detector = await loadDetector();
  const clips = [];
  const add = (clip, samples) => {
    const file = `${clip.id}.wav`;
    const hash = writeWav(join(outDir, file), samples);
    clips.push({
      ...clip,
      lang: 'en',
      file: `en/${file}`,
      durationS: Number((samples.length / RATE).toFixed(3)),
      peakDbfs: Number(peakDb(samples).toFixed(1)),
      sha256: hash,
      own: ownSpans(detector, samples),
    });
  };
  const seconds = (s) => Math.round(s * RATE);
  const silence = (s) => new Float32Array(seconds(s));
  const pink = (s, seed, levelDb) => atLevel(lavfi(`anoisesrc=c=pink:r=${RATE}:a=0.3:d=${s}:s=${seed}`), levelDb);

  // ---- negatives: the right transcript is empty
  const september = JSON.parse(readFileSync(join(speechDir, 'manifest.json'), 'utf8'));
  for (const id of ['neg-01', 'neg-02', 'neg-03']) {
    const c = september.clips.find((x) => x.id === id);
    add({ id, set: 'neg', kind: 'negative', label: `${c.label} (September clip)` }, decode(join(speechDir, 'clips', c.file)));
  }
  add({ id: 'neg-04', set: 'neg', kind: 'negative', label: 'pink noise at -30 dBFS, 20 s (fan / loud room)' }, pink(20, 11, -30));
  add({ id: 'neg-05', set: 'neg', kind: 'negative', label: 'white noise at -25 dBFS, 20 s (hiss)' }, atLevel(lavfi(`anoisesrc=c=white:r=${RATE}:a=0.3:d=20:s=12`), -25));
  add({ id: 'neg-06', set: 'neg', kind: 'negative', label: 'real music, solo piano (Chopin, CC0), 30 s' }, music.piano.subarray(seconds(20), seconds(50)).slice());
  add({ id: 'neg-07', set: 'neg', kind: 'negative', label: 'real music, instrumental band (Bartmann, CC0), 30 s' }, music.jazz.subarray(seconds(10), seconds(40)).slice());
  add({ id: 'neg-08', set: 'neg', kind: 'negative', label: 'real music, vlog bed (MacLeod, CC-BY-4.0), 30 s' }, music.vlog.subarray(seconds(5), seconds(35)).slice());
  add({ id: 'neg-09', set: 'neg', kind: 'negative', label: 'real music, vlog bed, 80 s (longer than one 30 s window)' }, fit(music.vlog, seconds(80)));
  add(
    { id: 'neg-10', set: 'neg', kind: 'negative', label: 'clicks (3 per second) over a 50 Hz hum, 20 s' },
    lavfi(`aevalsrc='0.004*sin(2*PI*50*t)+0.5*exp(-900*mod(t\\,0.333))*sin(2*PI*1800*t)':s=${RATE}:d=20`),
  );
  add({ id: 'neg-11', set: 'neg', kind: 'negative', label: 'room tone at -50 dBFS, 60 s (longer than one window)' }, pink(60, 13, -50));

  // ---- held-out negatives: never looked at while choosing the filter settings and guards
  add({ id: 'negh-01', set: 'negh', kind: 'negative', label: 'held out: piano, a later passage, 30 s' }, music.piano.subarray(seconds(75), seconds(105)).slice());
  add({ id: 'negh-02', set: 'negh', kind: 'negative', label: 'held out: band, a later passage, 25 s' }, music.jazz.subarray(seconds(40), seconds(65)).slice());
  add({ id: 'negh-03', set: 'negh', kind: 'negative', label: 'held out: vlog bed, a later passage, 30 s' }, music.vlog.subarray(seconds(45), seconds(75)).slice());
  add({ id: 'negh-04', set: 'negh', kind: 'negative', label: 'held out: vlog bed at -30 dBFS (quiet background), 30 s' }, atLevel(music.vlog.subarray(seconds(20), seconds(50)).slice(), -30));
  add({ id: 'negh-05', set: 'negh', kind: 'negative', label: 'held out: piano over room tone, 40 s' }, concat([atLevel(music.piano.subarray(seconds(120), seconds(140)).slice(), -26), pink(20, 51, -50)]));
  add({ id: 'negh-06', set: 'negh', kind: 'negative', label: 'held out: brown noise at -28 dBFS (wind / traffic), 30 s' }, atLevel(lavfi(`anoisesrc=c=brown:r=${RATE}:a=0.3:d=30:s=52`), -28));

  // ---- speech with long pauses: nothing may be written inside the gaps
  const pauseSpecs = [
    {
      id: 'pause-01',
      chapters: [[6930, 75918]],
      gaps: [
        { what: 'digital silence', samples: () => silence(8) },
        { what: 'room tone -55 dBFS', samples: () => pink(8, 21, -55) },
        { what: 'vlog music', samples: () => atLevel(fit(music.vlog, seconds(12), seconds(40)), -22) },
      ],
      lead: null,
      tail: null,
    },
    {
      id: 'pause-02',
      chapters: [[7127, 75946]],
      gaps: [
        { what: 'room tone -55 dBFS', samples: () => pink(10, 22, -55) },
        { what: 'piano music', samples: () => atLevel(fit(music.piano, seconds(15), seconds(60)), -24) },
        { what: 'digital silence', samples: () => silence(6) },
      ],
      lead: { what: 'vlog music intro', samples: () => atLevel(fit(music.vlog, seconds(20)), -20) },
      tail: { what: 'room tone -55 dBFS outro', samples: () => pink(15, 23, -55) },
    },
  ];
  for (const spec of pauseSpecs) {
    const utts = chapterUtterances(...spec.chapters[0]).slice(0, spec.gaps.length + 1);
    const parts = [];
    const words = [];
    const gaps = [];
    const texts = [];
    let at = 0;
    const pushGap = (g) => {
      const s = g.samples();
      gaps.push({ what: g.what, start: Number((at / RATE).toFixed(3)), end: Number(((at + s.length) / RATE).toFixed(3)) });
      parts.push(s);
      at += s.length;
    };
    if (spec.lead) pushGap(spec.lead);
    utts.forEach((u, i) => {
      const samples = decode(u.flac);
      const offset = at / RATE;
      for (const w of alignmentFor(u.id)) words.push({ w: w.w, s: Number((w.s + offset).toFixed(3)), e: Number((w.e + offset).toFixed(3)) });
      texts.push(u.text);
      parts.push(samples);
      at += samples.length;
      if (i < spec.gaps.length) pushGap(spec.gaps[i]);
    });
    if (spec.tail) pushGap(spec.tail);
    add({ id: spec.id, set: 'pause', kind: 'speech', reference: { raw: texts.join(' ') }, words, gaps, source: { dataset: 'librispeech test-clean', utterances: utts.map((u) => u.id) } }, concat(parts));
  }

  // ---- one clean passage under music and noise at several levels
  const mixBase = librispeechRun([[5683, 32865], [5683, 32866]], 150);
  const mixMeta = { reference: { raw: mixBase.text }, words: mixBase.words, source: { dataset: 'librispeech test-clean', utterances: mixBase.utts } };
  add({ id: 'mix-clean', set: 'mix', kind: 'speech', ...mixMeta }, mixBase.samples);
  for (const snr of [20, 10, 5, 0]) {
    const m = mix(mixBase.samples, fit(music.vlog, mixBase.samples.length, seconds(3)), snr);
    add({ id: `mix-music-${snr}`, set: 'mix', kind: 'speech', ...mixMeta, noise: { type: 'vlog music', snrDb: snr, bedGainDb: m.bedGainDb } }, m.samples);
  }
  for (const snr of [10, 5]) {
    const m = mix(mixBase.samples, lavfi(`anoisesrc=c=pink:r=${RATE}:a=0.3:d=${Math.ceil(mixBase.samples.length / RATE) + 1}:s=31`).subarray(0, mixBase.samples.length), snr);
    add({ id: `mix-pink-${snr}`, set: 'mix', kind: 'speech', ...mixMeta, noise: { type: 'pink noise', snrDb: snr, bedGainDb: m.bedGainDb } }, m.samples);
  }

  // ---- long form
  const longSpecs = [
    { id: 'long-a', chapters: [[1089, 134686], [1089, 134691]], targetS: 600, note: 'one male reader, 10 min' },
    { id: 'long-b', chapters: [[121, 127105], [121, 121726], [121, 123852], [121, 123859]], targetS: 600, note: 'one female reader, 10 min' },
    { id: 'long-c', chapters: [[2300, 131720], [4507, 16021], [61, 70968], [237, 134500]], targetS: 1200, perChapterS: 300, note: 'four readers in turn, 20 min' },
  ];
  for (const spec of longSpecs) {
    let run;
    if (spec.perChapterS) {
      const runs = spec.chapters.map((c) => librispeechRun([c], spec.perChapterS));
      let at = 0;
      const words = [];
      const utts = [];
      for (const r of runs) {
        const off = at / RATE;
        for (const w of r.words) words.push({ w: w.w, s: Number((w.s + off).toFixed(3)), e: Number((w.e + off).toFixed(3)) });
        for (const u of r.utts) utts.push({ id: u.id, start: Number((u.start + off).toFixed(3)), end: Number((u.end + off).toFixed(3)) });
        at += r.samples.length;
      }
      run = { samples: concat(runs.map((r) => r.samples)), text: runs.map((r) => r.text).join(' '), words, utts };
    } else {
      run = librispeechRun(spec.chapters, spec.targetS);
    }
    add({ id: spec.id, set: 'long', kind: 'speech', note: spec.note, reference: { raw: run.text }, words: run.words, source: { dataset: 'librispeech test-clean', utterances: run.utts } }, run.samples);
  }

  // FLEURS: distinct sentences, one recording each, joined with 0.7 s of quiet room tone.
  // FLEURS recordings differ in level by 50 dB (peaks from -0.2 to -54 dBFS in this
  // selection). `long-fleurs` brings every recording to a -3 dBFS peak, as one talker's
  // file would be; `long-fleurs-raw` leaves the levels alone (set `stress`): it shows
  // what a 40 dB drop inside one file does to the speech filter.
  {
    const seen = new Set();
    const parts = [];
    const rawParts = [];
    const texts = [];
    const utts = [];
    let at = 0;
    for (const e of fleursWavs) {
      const name = e.name.split('/').pop();
      const row = fleursRows.get(name);
      if (!row || seen.has(row.id)) continue;
      const file = join(fleursDir, name);
      if (!existsSync(file)) writeFileSync(file, e.data);
      const samples = decode(file);
      const dur = samples.length / RATE;
      if (dur < 4 || dur > 25) continue;
      seen.add(row.id);
      utts.push({ id: name, sentenceId: row.id, start: Number((at / RATE).toFixed(3)), end: Number(((at + samples.length) / RATE).toFixed(3)), text: row.raw });
      texts.push(row.raw);
      utts[utts.length - 1].peakDbfs = Number(peakDb(samples).toFixed(1));
      const tone = pink(0.7, 40 + utts.length, -60);
      parts.push(gain(samples, -3 - peakDb(samples)), tone);
      rawParts.push(samples, tone);
      at += samples.length + seconds(0.7);
      if (at / RATE >= 600) break;
    }
    const meta = { kind: 'speech', reference: { raw: texts.join(' ') }, words: null, source: { dataset: 'google/fleurs en_us test', utterances: utts } };
    add({ id: 'long-fleurs', set: 'long', note: `${utts.length} FLEURS sentences, a different speaker each, each recording peak-normalised to -3 dBFS; punctuated and cased text with numbers`, ...meta }, concat(parts));
    add({ id: 'long-fleurs-raw', set: 'stress', note: `the same ${utts.length} FLEURS recordings at their own levels (peaks ${Math.min(...utts.map((u) => u.peakDbfs))} to ${Math.max(...utts.map((u) => u.peakDbfs))} dBFS)`, ...meta }, concat(rawParts));
  }

  const manifest = { createdAt: new Date().toISOString(), sampleRate: RATE, downloads, ownDetector: { params: detector.DEFAULT_SILENCE_PARAMS, source: 'web/src/domain/silence.ts (transpiled as-is)' }, clips };
  writeFileSync(join(speechDir, 'manifest-en.json'), JSON.stringify(manifest));

  // ---- SOURCES.md: keep September's part, replace ours.
  const sourcesPath = join(speechDir, 'SOURCES.md');
  const marker = '<!-- october-english-set -->';
  const before = existsSync(sourcesPath) ? readFileSync(sourcesPath, 'utf8').split(marker)[0].trimEnd() : '';
  const lines = [
    marker,
    '## October 2026 English set (`node web/spike/asr/prepare-english.mjs`)',
    '',
    'Local only (gitignored). Open datasets and synthetic mixes; no user media.',
    '',
    '| What | URL | Licence | Bytes | sha256 |',
    '|---|---|---|---|---|',
    ...downloads.map((d) => `| ${d.title ?? d.name} | ${d.page ?? d.url} | ${d.license} | ${d.bytes} | \`${d.sha256}\` |`),
    '',
    '- LibriSpeech: V. Panayotov, G. Chen, D. Povey, S. Khudanpur, "LibriSpeech: an ASR corpus based on public domain audio books", ICASSP 2015. Only `test-clean` is used.',
    `- LibriSpeech Alignments: L. Lugosch et al., Montreal Forced Aligner word alignments for LibriSpeech, DOI ${ALIGNMENTS.doi}. Used as the reference word times.`,
    '- FLEURS: Conneau et al., 2022. Leading 48 MB of the en_us test tarball (HTTP Range) and the test TSV.',
    '- Music (Wikimedia Commons): "Scheming Weasel (faster)" by Kevin MacLeod (incompetech.com), CC-BY-4.0; Chopin Nocturne Op. 15 no. 1, CC0; "Robot Gypsy Jazz" by John Bartmann, CC0.',
    '- Noise, room tone, hum, clicks and silence: synthesised with ffmpeg.',
    '',
    '| id | set | seconds | what |',
    '|---|---|---|---|',
    ...clips.map((c) => `| ${c.id} | ${c.set} | ${c.durationS.toFixed(1)} | ${c.label ?? c.note ?? (c.noise ? `mix-clean + ${c.noise.type} at SNR ${c.noise.snrDb} dB` : c.gaps ? `LibriSpeech utterances with gaps: ${c.gaps.map((g) => g.what).join(', ')}` : 'LibriSpeech passage')} |`),
    '',
  ];
  writeFileSync(sourcesPath, `${before}\n\n${lines.join('\n')}`);

  console.log(`${clips.length} clips → ${outDir}`);
  for (const c of clips) {
    console.log(`  ${c.id.padEnd(13)} ${c.set.padEnd(5)} ${c.durationS.toFixed(1).padStart(7)} s  own=${c.own.status}/${c.own.spans.length} spans  ${c.words ? `${c.words.length} ref words` : ''}`);
  }
}

await main();
