/**
 * Builds the REALISTIC measurement set of "Yazıya dök" (ADR-036, 7 Oct 2026).
 *
 * The October spike and the first app-path measurements used read speech
 * (LibriSpeech audiobooks, FLEURS sentences). Real use on the live site
 * (founder, 5 Oct 2026: a 52-minute conversational video "missed much of the
 * speech") showed that is not what people bring. This set is conversational
 * and spontaneous English with reference transcripts, plus the two things
 * read speech never has: large loudness changes inside one file, and music
 * right next to (or under) the talking.
 *
 *   node scripts/transcript/prepare-realistic.mjs --set=dev
 *   node scripts/transcript/prepare-realistic.mjs --set=val     (made AFTER the settings were frozen on dev)
 *
 * Sources (all openly licensed, downloaded without a login; nothing is
 * uploaded anywhere; sources and licences: tests/media/SPEECH_SOURCE.md):
 *  - AMI Meeting Corpus (CC BY 4.0): real four-person meetings, headset mix
 *    and one far-field table microphone, with manual word times;
 *  - Earnings-22 (CC BY-SA 4.0): real earnings calls (prepared remarks and
 *    questions, telephone sound, many accents), whole calls, text only;
 *  - LibriSpeech test-clean + alignments (CC BY 4.0): clean speech with word
 *    times, used ONLY as raw material for the synthetic loudness steps;
 *  - music and everyday sounds from Wikimedia Commons (CC0 / public domain /
 *    CC BY), listed below.
 * The founder's own files (tests/media/real/) are never read.
 *
 * Writes tests/media/speech/real/*.wav (16 kHz mono 16-bit) and
 * tests/media/speech/manifest-real.json (gitignored).
 * `prepare-media.mjs` then wraps them as the videos the app opens.
 * Needs the spike's LibriSpeech pool (web/spike/asr/prepare-english.mjs).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const speechDir = join(webDir, 'tests', 'media', 'speech');
const poolDir = join(speechDir, '.pool');
const realPool = join(poolDir, 'realistic');
const lsDir = join(poolDir, 'librispeech');
const outDir = join(speechDir, 'real');
const RATE = 16000;
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const which = arg('set', 'dev');

// ---------------------------------------------------------------- sources
const AMI = {
  license: 'CC BY 4.0',
  audio: (meeting, signal) => `https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/${meeting}/audio/${meeting}.${signal}.wav`,
  annotations: 'https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip',
};
const EARNINGS = {
  license: 'CC BY-SA 4.0',
  audio: (id) => `https://media.githubusercontent.com/media/revdotcom/speech-datasets/main/earnings22/media/${id}.mp3`,
  text: (id) => `https://raw.githubusercontent.com/revdotcom/speech-datasets/main/earnings22/transcripts/nlp_references/${id}.nlp`,
};
const commons = (path) => `https://upload.wikimedia.org/wikipedia/commons/${path}`;
/** Music and everyday sounds. `set` says where a recording may be used: validation material is never played before the freeze. */
const SOUNDS = {
  // The spike's music (already in its pool; same files).
  vlog: { set: 'dev', title: 'Kevin MacLeod — Scheming Weasel (faster)', license: 'CC BY 4.0', url: commons('9/9e/Kevin_MacLeod_-_Scheming_Weasel_%28faster%29.wav'), ext: 'wav', pool: 'music' },
  piano: { set: 'dev', title: 'Chopin — Nocturne Op. 15 no. 1 in F major', license: 'CC0', url: commons('5/56/Chopin_-_Nocturne_Op._15_no._1_in_F_major.ogg'), ext: 'ogg', pool: 'music' },
  jazz: { set: 'dev', title: 'John Bartmann — Robot Gypsy Jazz', license: 'CC0', url: commons('1/11/John_Bartmann_-_13_-_Robot_Gypsy_Jazz.ogg'), ext: 'ogg', pool: 'music' },
  val1: { set: 'val', title: 'Kevin MacLeod — Calmant', license: 'CC BY 3.0', url: commons('3/3c/Kevin_MacLeod_-_Calmant.ogg'), ext: 'ogg', pool: 'music' },
  val2: { set: 'val', title: 'Kevin MacLeod — Windswept', license: 'CC BY 3.0', url: commons('2/23/Kevin_MacLeod_-_Windswept.ogg'), ext: 'ogg', pool: 'music' },
  // Everyday sounds without speech.
  applause: { set: 'dev', title: 'sandermotions — applause-2 (Freesound 277021)', license: 'CC0', url: commons('6/6d/277021_sandermotions_applause-2.wav'), ext: 'wav' },
  keyboard: { set: 'dev', title: 'Computer keyboard', license: 'Public domain', url: commons('a/a4/Computer_keyboard.ogg'), ext: 'ogg' },
  ocean: { set: 'dev', title: 'Ocean Waves on a Tropical Beach', license: 'CC0', url: commons('6/64/Ocean_Waves_on_a_Tropical_Beach.ogg'), ext: 'ogg' },
  typing: { set: 'val', title: 'Typing — Model M 1986', license: 'CC0', url: commons('0/0a/Typing_-_Model_M_1986.ogg'), ext: 'ogg' },
  surf: { set: 'val', title: 'Oceanwavescrushing', license: 'CC BY 3.0', url: commons('f/f1/Oceanwavescrushing.ogg'), ext: 'ogg' },
  sweeper: { set: 'val', title: 'Vacuum street cleaners after street parade', license: 'Public domain', url: commons('8/8b/Vacuum_street_cleaners_after_street_parade.ogg'), ext: 'ogg' },
};

// ---------------------------------------------------------------- helpers
function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { maxBuffer: 2 * 1024 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed:\n${r.stderr?.toString()}`);
  return r;
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const downloads = [];
async function fetchTo(url, dest, note = {}) {
  if (!existsSync(dest)) {
    const res = await fetch(url, { headers: { 'User-Agent': 'ClipTranscriptMeasure/0.1 (https://erenulutas0.github.io/capcut/; local test media) node' } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`prepare-realistic: downloaded ${url}`);
  }
  const buf = readFileSync(dest);
  if (downloads.some((d) => d.url === url)) return dest;
  downloads.push({ name: dest.slice(poolDir.length + 1).replace(/\\/g, '/'), url, bytes: buf.length, sha256: sha256(buf), ...note });
  return dest;
}
/** Any audio file → Float32 mono 16 kHz. */
function decode(input, post = []) {
  const r = sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, ...post, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)).slice();
}
const lavfi = (src) => {
  const r = sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', src, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)).slice();
};
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
  if (!existsSync(file) || !readFileSync(file).equals(buf)) writeFileSync(file, buf);
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
const seconds = (s) => Math.round(s * RATE);
const meanPower = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += x[i] * x[i];
  return s / Math.max(1, x.length);
};
const db = (p) => 10 * Math.log10(Math.max(p, 1e-12));
const gain = (x, gainDb) => x.map((v) => v * 10 ** (gainDb / 20));
const atLevel = (x, levelDb) => gain(x, levelDb - db(meanPower(x)));
const peakDb = (x) => {
  let p = 0;
  for (let i = 0; i < x.length; i += 1) p = Math.max(p, Math.abs(x[i]));
  return 20 * Math.log10(Math.max(p, 1e-9));
};
function fit(bed, length, from = 0) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = bed[(from + i) % bed.length];
  return out;
}
/** Speech + bed at a whole-clip SNR (mean power, pauses included — the spike's definition). */
function mix(speech, bed, snrDb) {
  const k = 10 ** ((db(meanPower(speech)) - snrDb - db(meanPower(bed))) / 20);
  const out = new Float32Array(speech.length);
  for (let i = 0; i < speech.length; i += 1) out[i] = (speech[i] + bed[i] * k) * 0.5;
  return out;
}
const pink = (s, seed, levelDb) => atLevel(lavfi(`anoisesrc=c=pink:r=${RATE}:a=0.3:d=${s}:s=${seed}`), levelDb);
const round3 = (value) => Number(value.toFixed(3));

/** A gain that changes over time: `steps` = [{ atS, db }], each change glides over `rampS`. */
function applySteps(samples, steps, rampS = 0.3) {
  const out = new Float32Array(samples.length);
  const ramp = Math.max(1, seconds(rampS));
  let k = 0;
  let from = steps[0].db;
  for (let i = 0; i < samples.length; i += 1) {
    while (k + 1 < steps.length && i >= seconds(steps[k + 1].atS)) {
      from = steps[k].db;
      k += 1;
    }
    const since = i - seconds(steps[k].atS);
    const level = k > 0 && since < ramp ? from + ((steps[k].db - from) * since) / ramp : steps[k].db;
    out[i] = samples[i] * 10 ** (level / 20);
  }
  return out;
}

/** Word intervals → the stretches that hold speech (words closer than 0.3 s are one stretch). */
function speechIntervals(words, joinS = 0.3) {
  const sorted = words.filter((w) => w.e > w.s).map((w) => ({ start: w.s, end: w.e })).sort((a, b) => a.start - b.start);
  const out = [];
  for (const interval of sorted) {
    const last = out[out.length - 1];
    if (last && interval.start - last.end <= joinS) last.end = Math.max(last.end, interval.end);
    else out.push({ ...interval });
  }
  return out.map((i) => ({ start: round3(i.start), end: round3(i.end) }));
}

// ---------------------------------------------------------------- AMI
function amiAnnotations() {
  const zip = join(realPool, 'ami_public_manual_1.6.2.zip');
  const dir = join(realPool, 'ami-ann');
  if (!existsSync(join(dir, 'words', 'TS3003a.A.words.xml'))) {
    // bsdtar (ships with Windows 10+, and is `tar` on macOS) reads zip archives; GNU tar does not.
    const bsdtar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    mkdirSync(dir, { recursive: true });
    sh(bsdtar, ['-xf', zip, '-C', dir, 'words']);
  }
  return join(dir, 'words');
}
const unescapeXml = (text) => text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Every speaker's manually transcribed words of a meeting, in time order. Punctuation, truncated words and noises are not words. */
function amiWords(meeting) {
  const dir = amiAnnotations();
  const words = [];
  for (const name of readdirSync(dir).filter((file) => file.startsWith(`${meeting}.`) && file.endsWith('.words.xml'))) {
    const speaker = name.split('.')[1];
    const xml = readFileSync(join(dir, name), 'latin1');
    const re = /<w\s([^>]*)>([^<]*)<\/w>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attrs = m[1];
      if (/punc="true"/.test(attrs) || /trunc="true"/.test(attrs)) continue;
      const s = Number(/starttime="([\d.]+)"/.exec(attrs)?.[1]);
      const e = Number(/endtime="([\d.]+)"/.exec(attrs)?.[1]);
      const w = unescapeXml(m[2]).trim();
      if (!w || !Number.isFinite(s) || !Number.isFinite(e)) continue;
      words.push({ w, s, e, speaker });
    }
  }
  return words.sort((a, b) => a.s - b.s || a.e - b.e);
}
async function amiAudio(meeting, signal) {
  const file = await fetchTo(AMI.audio(meeting, signal), join(realPool, 'ami', `${meeting}.${signal}.wav`), { license: AMI.license, dataset: 'AMI Meeting Corpus' });
  return decode(file);
}
/** A stretch of an AMI meeting with its words on the stretch's own clock. */
function amiCut(samples, words, fromS, toS) {
  const cut = samples.subarray(seconds(fromS), Math.min(samples.length, seconds(toS))).slice();
  const inside = words.filter((w) => w.s >= fromS && w.e <= toS).map((w) => ({ w: w.w, s: round3(w.s - fromS), e: round3(w.e - fromS) }));
  return { samples: cut, words: inside };
}
const textOf = (words) => words.map((w) => w.w).join(' ');

// ---------------------------------------------------------------- Earnings-22
async function earningsCall(id) {
  const audio = await fetchTo(EARNINGS.audio(id), join(realPool, 'earnings22', `${id}.mp3`), { license: EARNINGS.license, dataset: 'Earnings-22' });
  const nlp = await fetchTo(EARNINGS.text(id), join(realPool, 'earnings22', `${id}.nlp`), { license: EARNINGS.license, dataset: 'Earnings-22' });
  const tokens = readFileSync(nlp, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((line) => line.split('|')[0]);
  return { samples: decode(audio), text: tokens.join(' ') };
}

// ---------------------------------------------------------------- LibriSpeech (raw material for the loudness steps)
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
/** The first `count` utterances of a reader's first chapter: samples and word times, each utterance apart. */
function librispeechUtterances(speaker, count, skip = 0) {
  const speakerDir = join(lsDir, 'LibriSpeech', 'test-clean', String(speaker));
  if (!existsSync(speakerDir)) throw new Error(`no LibriSpeech pool at ${speakerDir}: run web/spike/asr/prepare-english.mjs first`);
  const chapter = readdirSync(speakerDir).sort()[0];
  const dir = join(speakerDir, chapter);
  const lines = readFileSync(join(dir, `${speaker}-${chapter}.trans.txt`), 'utf8').split(/\r?\n/).filter(Boolean).slice(skip, skip + count);
  return lines.map((line) => {
    const id = line.slice(0, line.indexOf(' '));
    const grid = join(lsDir, 'alignments', 'test-clean', String(speaker), chapter, `${id}.TextGrid`);
    return { id, samples: decode(join(dir, `${id}.flac`)), words: parseTextGrid(readFileSync(grid, 'utf8')) };
  });
}

// ---------------------------------------------------------------- the sets
const clips = [];
function add(clip, samples) {
  const file = `${clip.id}.wav`;
  const hash = writeWav(join(outDir, file), samples);
  const withSpeech = clip.words && !clip.speech ? { speech: speechIntervals(clip.words) } : {};
  clips.push({ ...clip, ...withSpeech, lang: 'en', file: `real/${file}`, durationS: round3(samples.length / RATE), peakDbfs: Number(peakDb(samples).toFixed(1)), sha256: hash });
  console.log(`prepare-realistic: ${clip.id} ${(samples.length / RATE).toFixed(1)} s`);
}

async function sound(key) {
  const meta = SOUNDS[key];
  if (meta.set === 'val' && which !== 'val') throw new Error(`${key} is validation material: not before the freeze`);
  const file = await fetchTo(meta.url, join(poolDir, meta.pool ?? 'realistic/sounds', `${key}.${meta.ext}`), { license: meta.license, title: meta.title });
  return decode(file);
}

/**
 * Clean speech whose level steps up and down inside one file: each utterance
 * group is played at its own gain, a second of room tone between groups.
 * `pattern` is the gain of each group in dB.
 */
function loudnessSteps(speakers, perSpeaker, pattern, toneSeed) {
  const parts = [];
  const words = [];
  const levels = [];
  let at = 0;
  let group = 0;
  for (const speaker of speakers) {
    for (const utterance of librispeechUtterances(speaker, perSpeaker)) {
      const gainDb = pattern[group % pattern.length];
      const offset = at / RATE;
      for (const w of utterance.words) words.push({ w: w.w, s: round3(w.s + offset), e: round3(w.e + offset) });
      levels.push({ start: round3(offset), end: round3(offset + utterance.samples.length / RATE), gainDb });
      parts.push(gain(utterance.samples, gainDb));
      at += utterance.samples.length;
      const tone = pink(1, toneSeed + group, -62);
      parts.push(tone);
      at += tone.length;
      group += 1;
    }
  }
  return { samples: concat(parts), words, levels };
}

/** Speech with stretches of music or noise butted right against it (no silence between): nothing may be written in the gaps. */
function speechWithNeighbours(utterances, fillers) {
  const parts = [];
  const words = [];
  const gaps = [];
  let at = 0;
  const pushGap = (filler) => {
    if (!filler) return;
    gaps.push({ what: filler.what, start: round3(at / RATE), end: round3((at + filler.samples.length) / RATE) });
    parts.push(filler.samples);
    at += filler.samples.length;
  };
  pushGap(fillers[0]);
  utterances.forEach((utterance, index) => {
    const offset = at / RATE;
    for (const w of utterance.words) words.push({ w: w.w, s: round3(w.s + offset), e: round3(w.e + offset) });
    parts.push(utterance.samples);
    at += utterance.samples.length;
    pushGap(fillers[index + 1]);
  });
  return { samples: concat(parts), words, gaps };
}

async function buildDev() {
  // ---- real conversation: a four-person meeting, close microphones mixed, and the same meeting from one table microphone
  const es2004a = amiWords('ES2004a');
  add({ id: 'ami-es2004a', set: 'rdev', kind: 'speech', note: 'AMI ES2004a, headset mix: four people in a design meeting (overlaps, fillers, laughter)', reference: { raw: textOf(es2004a) }, words: es2004a.map(({ w, s, e }) => ({ w, s, e })), source: { dataset: 'AMI', meeting: 'ES2004a', signal: 'Mix-Headset' } }, await amiAudio('ES2004a', 'Mix-Headset'));
  add({ id: 'ami-es2004a-far', set: 'rdev', kind: 'speech', note: 'AMI ES2004a, ONE far-field table microphone (quiet, reverberant — a camera across the room)', reference: { raw: textOf(es2004a) }, words: es2004a.map(({ w, s, e }) => ({ w, s, e })), source: { dataset: 'AMI', meeting: 'ES2004a', signal: 'Array1-01' } }, await amiAudio('ES2004a', 'Array1-01'));

  // ---- a real call: prepared remarks, then questions and answers; telephone sound
  const call = await earningsCall('4475604');
  add({ id: 'earn-4475604', set: 'rdev', kind: 'speech', note: 'Earnings-22 call 4475604 (UK), whole call; reference has no word times', reference: { raw: call.text }, words: null, source: { dataset: 'Earnings-22', file: '4475604' } }, call.samples);

  // ---- loudness changes inside one file
  const steps = loudnessSteps([260, 672, 908, 1188], 6, [0, -30, -10, -40, -20, -35, 0, -45], 100);
  add({ id: 'steps-libri', set: 'rdev', kind: 'speech', note: 'clean read speech, four readers; each utterance at its own level: 0 / -30 / -10 / -40 / -20 / -35 / 0 / -45 dB', reference: { raw: textOf(steps.words) }, words: steps.words, levels: steps.levels, source: { dataset: 'librispeech test-clean', speakers: [260, 672, 908, 1188] } }, steps.samples);

  const es2004b = amiWords('ES2004b');
  const meetingB = await amiAudio('ES2004b', 'Mix-Headset');
  const quietTalk = amiCut(meetingB, es2004b, 120, 480);
  const talkSteps = [{ atS: 0, db: 0 }, { atS: 45, db: -25 }, { atS: 100, db: -40 }, { atS: 160, db: -12 }, { atS: 210, db: -35 }, { atS: 270, db: 0 }, { atS: 310, db: -30 }];
  add({ id: 'steps-ami', set: 'rdev', kind: 'speech', note: 'AMI ES2004b 2:00–8:00 with the level stepping 0 / -25 / -40 / -12 / -35 / 0 / -30 dB', reference: { raw: textOf(quietTalk.words) }, words: quietTalk.words, levels: talkSteps, source: { dataset: 'AMI', meeting: 'ES2004b', signal: 'Mix-Headset', fromS: 120, toS: 480 } }, applySteps(quietTalk.samples, talkSteps));

  // ---- music under the talking
  const vlog = await sound('vlog');
  const bedTalk = amiCut(meetingB, es2004b, 600, 900);
  add({ id: 'bed-ami-10', set: 'rdev', kind: 'speech', note: 'AMI ES2004b 10:00–15:00 with a vlog music bed at SNR 10 dB', reference: { raw: textOf(bedTalk.words) }, words: bedTalk.words, noise: { type: 'vlog music', snrDb: 10 }, source: { dataset: 'AMI', meeting: 'ES2004b', signal: 'Mix-Headset', fromS: 600, toS: 900 } }, mix(bedTalk.samples, fit(vlog, bedTalk.samples.length, seconds(12)), 10));

  // ---- music and noise right next to the talking (no silence between): the gaps must stay empty
  const piano = await sound('piano');
  const jazz = await sound('jazz');
  const readers = librispeechUtterances(1221, 4);
  const next = speechWithNeighbours(readers, [
    { what: 'vlog music intro, 12 s', samples: vlog.subarray(seconds(30), seconds(42)).slice() },
    { what: 'piano, 8 s', samples: piano.subarray(seconds(60), seconds(68)).slice() },
    { what: 'quiet vlog music (-40 dBFS), 10 s', samples: atLevel(vlog.subarray(seconds(50), seconds(60)).slice(), -40) },
    { what: 'band, 10 s', samples: jazz.subarray(seconds(20), seconds(30)).slice() },
    { what: 'vlog music outro, 15 s', samples: vlog.subarray(seconds(70), seconds(85)).slice() },
  ]);
  add({ id: 'next-music', set: 'rdev', kind: 'speech', note: 'clean speech with music butted right against it (intro, between sentences, outro): nothing may be written in the music', reference: { raw: textOf(next.words) }, words: next.words, gaps: next.gaps, source: { dataset: 'librispeech test-clean', speakers: [1221] } }, next.samples);

  // ---- negatives aimed at level normalisation: quiet things must not become "speech" when they are turned up
  const neg = (id, label, samples) => add({ id, set: 'rneg', kind: 'negative', label }, samples);
  neg('rneg-01', 'piano at -52 dBFS (very quiet), 30 s', atLevel(piano.subarray(seconds(30), seconds(60)).slice(), -52));
  neg('rneg-02', 'vlog music at -55 dBFS (very quiet), 30 s', atLevel(vlog.subarray(seconds(10), seconds(40)).slice(), -55));
  neg('rneg-03', 'vlog music loud (-20 dBFS) 20 s, then the same music 40 dB quieter, 30 s', concat([atLevel(vlog.subarray(seconds(0), seconds(20)).slice(), -20), atLevel(vlog.subarray(seconds(20), seconds(50)).slice(), -60)]));
  neg('rneg-04', 'band loud 15 s, room tone (-60 dBFS) 20 s, band at -48 dBFS 25 s', concat([atLevel(jazz.subarray(seconds(5), seconds(20)).slice(), -18), pink(20, 301, -60), atLevel(jazz.subarray(seconds(40), seconds(65)).slice(), -48)]));
  neg('rneg-05', 'pink noise at -65 dBFS (a quiet room turned up 40 dB is still a room), 30 s', pink(30, 302, -65));
  neg('rneg-06', 'white noise at -70 dBFS, 20 s, then pink noise at -30 dBFS, 20 s', concat([atLevel(lavfi(`anoisesrc=c=white:r=${RATE}:a=0.3:d=20:s=303`), -70), pink(20, 304, -30)]));
  neg('rneg-07', 'applause (real recording)', (await sound('applause')).subarray(0, seconds(30)).slice());
  neg('rneg-08', 'computer keyboard (real recording), 40 s', (await sound('keyboard')).subarray(0, seconds(40)).slice());
  neg('rneg-09', 'ocean waves (real recording), 45 s', (await sound('ocean')).subarray(seconds(10), seconds(55)).slice());
  neg('rneg-10', 'ocean waves at -50 dBFS after 10 s of loud applause', concat([(await sound('applause')).subarray(0, seconds(10)).slice(), atLevel((await sound('ocean')).subarray(seconds(60), seconds(90)).slice(), -50)]));
}

/**
 * The validation set. Written and built on 7 Oct 2026 AFTER the settings were
 * frozen on the development set (the freeze is its own commit), and run once.
 * Nothing here was heard by a model before: other meetings (another site,
 * other speakers), other calls, other readers, other music, other sounds.
 */
async function buildVal() {
  // ---- real conversation: a meeting recorded at another site, headset mix and one table microphone
  const is1009a = amiWords('IS1009a');
  const plain = (words) => words.map(({ w, s, e }) => ({ w, s, e }));
  add({ id: 'ami-is1009a', set: 'rval', kind: 'speech', note: 'AMI IS1009a, headset mix (Idiap room, four other speakers)', reference: { raw: textOf(is1009a) }, words: plain(is1009a), source: { dataset: 'AMI', meeting: 'IS1009a', signal: 'Mix-Headset' } }, await amiAudio('IS1009a', 'Mix-Headset'));
  add({ id: 'ami-is1009a-far', set: 'rval', kind: 'speech', note: 'AMI IS1009a, ONE far-field table microphone', reference: { raw: textOf(is1009a) }, words: plain(is1009a), source: { dataset: 'AMI', meeting: 'IS1009a', signal: 'Array1-01' } }, await amiAudio('IS1009a', 'Array1-01'));

  // ---- real calls: one of 51 minutes (the length of the video that showed the problem), one with another accent
  for (const [id, note] of [
    ['4474229', 'Earnings-22 call 4474229 (UK), whole call, 51 minutes'],
    ['4481221', 'Earnings-22 call 4481221 (India), whole call'],
  ]) {
    const call = await earningsCall(id);
    add({ id: `earn-${id}`, set: 'rval', kind: 'speech', note: `${note}; reference has no word times`, reference: { raw: call.text }, words: null, source: { dataset: 'Earnings-22', file: id } }, call.samples);
  }

  // ---- loudness changes inside one file: other readers, another order of levels
  const steps = loudnessSteps([3570, 3575, 4077, 4446], 6, [-38, 0, -25, -42, -8, -33, -48, 0], 500);
  add({ id: 'steps-libri-v', set: 'rval', kind: 'speech', note: 'clean read speech, four other readers; each utterance at its own level: -38 / 0 / -25 / -42 / -8 / -33 / -48 / 0 dB', reference: { raw: textOf(steps.words) }, words: steps.words, levels: steps.levels, source: { dataset: 'librispeech test-clean', speakers: [3570, 3575, 4077, 4446] } }, steps.samples);

  const ts3003a = amiWords('TS3003a');
  const meeting = await amiAudio('TS3003a', 'Mix-Headset');
  const quietTalk = amiCut(meeting, ts3003a, 180, 540);
  const talkSteps = [{ atS: 0, db: -30 }, { atS: 50, db: 0 }, { atS: 95, db: -42 }, { atS: 150, db: -18 }, { atS: 200, db: -36 }, { atS: 260, db: -6 }, { atS: 305, db: -28 }];
  add({ id: 'steps-ami-v', set: 'rval', kind: 'speech', note: 'AMI TS3003a 3:00–9:00 with the level stepping -30 / 0 / -42 / -18 / -36 / -6 / -28 dB', reference: { raw: textOf(quietTalk.words) }, words: quietTalk.words, levels: talkSteps, source: { dataset: 'AMI', meeting: 'TS3003a', signal: 'Mix-Headset', fromS: 180, toS: 540 } }, applySteps(quietTalk.samples, talkSteps));

  // ---- music under the talking: a track no model has been played
  const calmant = await sound('val1');
  const windswept = await sound('val2');
  const bedTalk = amiCut(meeting, ts3003a, 660, 960);
  add({ id: 'bed-ami-v', set: 'rval', kind: 'speech', note: 'AMI TS3003a 11:00–16:00 with "Calmant" under it at SNR 10 dB', reference: { raw: textOf(bedTalk.words) }, words: bedTalk.words, noise: { type: 'music (Calmant)', snrDb: 10 }, source: { dataset: 'AMI', meeting: 'TS3003a', signal: 'Mix-Headset', fromS: 660, toS: 960 } }, mix(bedTalk.samples, fit(calmant, bedTalk.samples.length, seconds(8)), 10));

  // ---- music and sounds right next to the talking
  const typing = await sound('typing');
  const surf = await sound('surf');
  const sweeper = await sound('sweeper');
  const next = speechWithNeighbours(librispeechUtterances(5105, 5), [
    { what: '"Windswept" intro, 14 s', samples: windswept.subarray(seconds(20), seconds(34)).slice() },
    { what: '"Calmant", 9 s', samples: calmant.subarray(seconds(50), seconds(59)).slice() },
    { what: 'typing, 6 s', samples: fit(typing, seconds(6)) },
    { what: 'quiet "Windswept" (-42 dBFS), 10 s', samples: atLevel(windswept.subarray(seconds(90), seconds(100)).slice(), -42) },
    { what: 'surf, 8 s', samples: surf.subarray(seconds(5), seconds(13)).slice() },
    { what: '"Calmant" outro, 15 s', samples: calmant.subarray(seconds(100), seconds(115)).slice() },
  ]);
  add({ id: 'next-music-v', set: 'rval', kind: 'speech', note: 'clean speech with music and everyday sounds butted right against it: nothing may be written in them', reference: { raw: textOf(next.words) }, words: next.words, gaps: next.gaps, source: { dataset: 'librispeech test-clean', speakers: [5105] } }, next.samples);

  // ---- negatives: no speech at all
  const neg = (id, label, samples) => add({ id, set: 'rnegv', kind: 'negative', label }, samples);
  neg('rnegv-01', '"Calmant" at -54 dBFS (very quiet), 30 s', atLevel(calmant.subarray(seconds(20), seconds(50)).slice(), -54));
  neg('rnegv-02', '"Windswept" at -50 dBFS (very quiet), 40 s', atLevel(windswept.subarray(seconds(40), seconds(80)).slice(), -50));
  neg('rnegv-03', '"Windswept" loud (-20 dBFS) 20 s, then 38 dB quieter, 30 s', concat([atLevel(windswept.subarray(seconds(0), seconds(20)).slice(), -20), atLevel(windswept.subarray(seconds(20), seconds(50)).slice(), -58)]));
  neg('rnegv-04', '"Calmant" loud 15 s, room tone (-62 dBFS) 20 s, "Calmant" at -46 dBFS 25 s', concat([atLevel(calmant.subarray(seconds(5), seconds(20)).slice(), -20), pink(20, 701, -62), atLevel(calmant.subarray(seconds(60), seconds(85)).slice(), -46)]));
  neg('rnegv-05', 'brown noise at -68 dBFS, 30 s', atLevel(lavfi(`anoisesrc=c=brown:r=${RATE}:a=0.3:d=30:s=702`), -68));
  neg('rnegv-06', 'pink noise stepping -70 / -40 / -60 dBFS, 45 s', concat([pink(15, 703, -70), pink(15, 704, -40), pink(15, 705, -60)]));
  neg('rnegv-07', 'typing (real recording)', fit(typing, seconds(Math.min(30, typing.length / RATE))));
  neg('rnegv-08', 'surf (real recording), 40 s', surf.subarray(seconds(0), seconds(40)).slice());
  neg('rnegv-09', 'street sweepers (real recording), 45 s', sweeper.subarray(seconds(10), seconds(55)).slice());
  neg('rnegv-10', 'street sweepers 12 s, then surf at -52 dBFS 30 s', concat([sweeper.subarray(seconds(60), seconds(72)).slice(), atLevel(surf.subarray(seconds(40), seconds(70)).slice(), -52)]));
}

mkdirSync(outDir, { recursive: true });
await fetchTo(AMI.annotations, join(realPool, 'ami_public_manual_1.6.2.zip'), { license: AMI.license, dataset: 'AMI Meeting Corpus, manual annotations 1.6.2' });
if (which === 'dev') await buildDev();
else if (which === 'val') await buildVal();
else throw new Error(`unknown --set=${which}`);

// The two sets are built at different times: each run replaces only its own clips in the manifest.
const manifestFile = join(speechDir, 'manifest-real.json');
const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { clips: [], downloads: [] };
const mine = new Set(clips.map((clip) => clip.id));
const merged = {
  updatedAt: new Date().toISOString(),
  built: { ...(previous.built ?? {}), [which]: new Date().toISOString() },
  clips: [...previous.clips.filter((clip) => !mine.has(clip.id)), ...clips],
  downloads: [...previous.downloads.filter((d) => !downloads.some((n) => n.name === d.name)), ...downloads],
};
writeFileSync(manifestFile, `${JSON.stringify(merged, null, 1)}\n`);
console.log(`prepare-realistic: ${clips.length} clips (${which}); ${merged.clips.length} in ${manifestFile}`);
for (const d of downloads) console.log(`  ${d.name} ${d.bytes} bytes sha256 ${d.sha256.slice(0, 16)}… ${d.license ?? ''}`);
