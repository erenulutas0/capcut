/**
 * Builds the video files the transcript measurements run on (ADR-036).
 *
 * The October spike measured 16 kHz WAV clips fed straight to the recogniser
 * (`web/tests/media/speech/`, made by `web/spike/asr/prepare-speech.mjs` and
 * `prepare-english.mjs`; rights and sources in that folder's SOURCES.md).
 * The app takes VIDEOS, so every clip is wrapped here the way a phone
 * recording arrives: an MP4 with a small black picture and the same sound as
 * AAC, 48 kHz stereo, 128 kbit/s. Measuring these goes through the whole
 * shipped path — AAC decode, down-mix, 48 → 16 kHz, speech detection,
 * recogniser — which the spike did not ("video dosyasından çözülen ses" was
 * on its not-measured list).
 *
 *   node scripts/transcript/prepare-media.mjs [--speech=<dir>] [--long]
 *
 * `--long` also builds the 60- and 120-minute files (the spike's long clips
 * end to end, repeated) for the speed and memory measurements.
 * Output: tests/media/transcript/ (gitignored) + manifest.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const speechDir = resolve(webDir, arg('speech', 'tests/media/speech'));
const outDir = join(webDir, 'tests', 'media', 'transcript');
const withLong = args.includes('--long');

if (!existsSync(join(speechDir, 'manifest-en.json'))) {
  console.error(`prepare-media: no speech set at ${speechDir} (run web/spike/asr/prepare-speech.mjs and prepare-english.mjs, or pass --speech=<dir>)`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function ffmpeg(argv) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${argv.join(' ')}`);
}

/** WAV → MP4: black 320×240 picture at 5 fps, AAC 48 kHz stereo 128 kbit/s, as long as the sound. */
function wrap(wav, mp4) {
  if (existsSync(mp4)) return;
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=5',
    '-i', wav,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-g', '25',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-shortest', '-movflags', '+faststart',
    mp4,
  ]);
}

const english = JSON.parse(readFileSync(join(speechDir, 'manifest-en.json'), 'utf8'));
const september = JSON.parse(readFileSync(join(speechDir, 'manifest.json'), 'utf8'));
const referenceText = (reference) => (typeof reference === 'string' ? reference : (reference?.raw ?? ''));

const clips = [];
for (const clip of english.clips) {
  const wav = join(speechDir, clip.file);
  const file = `${clip.id}.mp4`;
  wrap(wav, join(outDir, file));
  clips.push({
    id: clip.id,
    set: clip.set,
    kind: clip.kind,
    file,
    durationS: clip.durationS,
    reference: referenceText(clip.reference),
    words: clip.words ?? null,
    gaps: clip.gaps ?? null,
  });
  console.log(`prepare-media: ${file}`);
}
// The September short set (FLEURS sentences), kept for continuity with both spikes.
for (const id of ['en-01', 'en-02', 'en-03', 'en-04', 'en-05', 'en-06', 'noisy-04']) {
  const clip = september.clips.find((item) => item.id === id);
  if (!clip) continue;
  const file = `${id}.mp4`;
  wrap(join(speechDir, 'clips', clip.file), join(outDir, file));
  clips.push({ id, set: 'short', kind: clip.kind, file, durationS: clip.durationS, reference: referenceText(clip.reference), words: null, gaps: null });
  console.log(`prepare-media: ${file}`);
}

if (withLong) {
  // The spike's long clips end to end, repeated until the target length: dense read speech throughout.
  const parts = ['long-c', 'long-a', 'long-b', 'long-fleurs'].map((id) => english.clips.find((clip) => clip.id === id)).filter(Boolean);
  for (const [name, minutes] of [['long-60min', 60], ['long-120min', 120]]) {
    const mp4 = join(outDir, `${name}.mp4`);
    const order = [];
    let total = 0;
    for (let k = 0; total < minutes * 60; k += 1) {
      const part = parts[k % parts.length];
      order.push(part);
      total += part.durationS;
    }
    if (!existsSync(mp4)) {
      const list = join(outDir, `${name}.txt`);
      writeFileSync(list, order.map((part) => `file '${join(speechDir, part.file).replace(/\\/g, '/')}'`).join('\n'));
      const wav = join(outDir, `${name}.wav`);
      // Cut at exactly the target length, so the 120-minute file is inside the app's input limit.
      ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-t', String(minutes * 60 - 1), '-c:a', 'pcm_s16le', wav]);
      wrap(wav, mp4);
    }
    clips.push({ id: name, set: 'xlong', kind: 'speech', file: `${name}.mp4`, durationS: minutes * 60 - 1, reference: null, words: null, gaps: null, parts: order.map((part) => part.id) });
    console.log(`prepare-media: ${name}.mp4`);
  }
}

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), source: speechDir, clips }, null, 1)}\n`);
console.log(`prepare-media: ${clips.length} clips in ${outDir}`);
