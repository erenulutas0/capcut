/**
 * Tests of the measurement harness. Every network call goes to the local mock
 * (127.0.0.1); nothing here can reach the provider — the last test proves the
 * client refuses to.
 *
 *   node --test cloud/harness/test/
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CODECS, extractArgs } from '../lib/audio.mjs';
import { isPrivatePath, loadManifest, resolveEntry } from '../lib/manifest.mjs';
import { PRICING, costUsd, hourlyRateUsd } from '../lib/pricing.mjs';
import { PROVIDER_BASES, ProviderError, createProviderClient, transcriptParams } from '../lib/provider.mjs';
import { DEFAULT_MAX_USD, EXIT, main, parseArgs } from '../lib/run.mjs';
import { errors, scoreTranscript } from '../lib/score.mjs';
import { REDACTED, readKeyFromEnvFile, redact } from '../lib/secrets.mjs';
import { startMockProvider } from '../mock/assemblyai-mock.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const KEY = 'test-key-9f3a1c77e2b04d5588aa';
const speechFile = join(repoRoot, 'web', 'tests', 'media', 'speech-fleurs-en-01.mp4');

let scratch;
let envFile;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cloud-harness-test-'));
  envFile = join(scratch, '.env');
  writeFileSync(envFile, `# test\nASSEMBLYAI_API_KEY=${KEY}\n`);
});
after(() => rmSync(scratch, { recursive: true, force: true }));

/** Runs main() and collects what it printed. */
async function run(argv, deps = {}) {
  const lines = [];
  const code = await main(argv, { out: (line) => lines.push(line), sleep: async () => {}, ...deps });
  return { code, text: lines.join('\n') };
}
const noNetwork = () => {
  throw new Error('a network request was attempted');
};
const fastClient = { sleep: async () => {} };

describe('prices', () => {
  test('are the documented ones (assemblyai.com/pricing, read 2026-10-10)', () => {
    assert.equal(PRICING.models['universal-3-5-pro'], 0.21);
    assert.equal(PRICING.models['universal-2'], 0.15);
    assert.equal(PRICING.addOns.speakerLabels, 0.02);
    assert.equal(PRICING.addOns.translation, 0.06);
    assert.equal(PRICING.readOn, '2026-10-10');
  });
  test('a fallback list is priced at its most expensive model; add-ons stack', () => {
    assert.equal(hourlyRateUsd({ models: ['universal-2', 'universal-3-5-pro'] }), 0.21);
    assert.ok(Math.abs(hourlyRateUsd({ models: ['universal-3-5-pro'], speakerLabels: true }) - 0.23) < 1e-12);
    assert.throws(() => hourlyRateUsd({ models: ['made-up'] }), /no documented price/);
  });
  test('one hour with speaker labels costs $0.23; partial seconds round up', () => {
    assert.ok(Math.abs(costUsd(3600, { models: ['universal-3-5-pro'], speakerLabels: true }) - 0.23) < 1e-12);
    assert.equal(costUsd(0.2, { models: ['universal-2'] }), 0.15 / 3600);
  });
  test('the default ceiling is 0.50 USD', () => {
    assert.equal(DEFAULT_MAX_USD, 0.5);
    assert.equal(parseArgs([]).maxUsd, 0.5);
  });
});

describe('key handling', () => {
  test('reads only the named key from an env file; an empty value is no key', () => {
    assert.equal(readKeyFromEnvFile(envFile), KEY);
    const empty = join(scratch, 'empty.env');
    writeFileSync(empty, 'ASSEMBLYAI_API_KEY=\n');
    assert.equal(readKeyFromEnvFile(empty), null);
    assert.equal(readKeyFromEnvFile(join(scratch, 'nope.env')), null);
  });
  test('redact removes the key and authorization values', () => {
    const text = redact(`boom authorization: ${KEY} and again ${KEY}; ASSEMBLYAI_API_KEY=${KEY}`, [KEY]);
    assert.ok(!text.includes(KEY));
    assert.ok(text.includes(REDACTED));
    assert.ok(!redact('{"Authorization":"Bearer abc.def.ghi"}').includes('abc.def.ghi'));
  });
});

describe('manifest', () => {
  test('loads, and every entry under web/tests/media/real/ is private', () => {
    const manifest = loadManifest();
    const resolved = manifest.entries.map((entry) => resolveEntry(entry));
    const inReal = resolved.filter((entry) => entry.file && /tests[\\/]media[\\/]real[\\/]/.test(entry.file));
    assert.ok(inReal.length >= 1);
    assert.ok(inReal.every((entry) => entry.private === true));
    for (const category of ['long conversation', 'speech under music', 'far-field microphone', 'Japanese', 'Turkish', 'two-speaker overlap']) {
      assert.ok(manifest.entries.some((entry) => entry.category === category), `no entry for "${category}"`);
    }
    const missing = manifest.entries.filter((entry) => entry.status === 'missing').map((entry) => entry.id);
    assert.deepEqual(missing.sort(), ['japanese-conversation', 'japanese-read', 'turkish-conversation', 'two-speaker-overlap']);
  });
  test('the private rule is by path, whatever the manifest says', () => {
    assert.equal(isPrivatePath(join('E:', 'capcut_better', 'web', 'tests', 'media', 'real', 'a.mp4')), true);
    assert.equal(isPrivatePath(join(repoRoot, 'web', 'tests', 'media', 'REAL', 'sub', 'a.mp4')), true);
    assert.equal(isPrivatePath(join(repoRoot, 'web', 'tests', 'media', 'speech', 'real', 'ami-is1009a.wav')), false);
    assert.equal(isPrivatePath(speechFile), false);
    const bad = join(scratch, 'bad-manifest.json');
    writeFileSync(bad, JSON.stringify({ entries: [{ id: 'x', file: 'web/tests/media/real/x.mp4' }] }));
    assert.throws(() => loadManifest(bad), /not marked private/);
  });
  test('the committed smoke file exists and has a reference', () => {
    const entry = resolveEntry(loadManifest().entries.find((item) => item.id === 'smoke-fleurs-en'));
    assert.equal(entry.exists, true);
    assert.equal(entry.private, false);
    assert.match(entry.reference, /Vichy/);
  });
});

describe('sound only', () => {
  test('the ffmpeg command drops picture, subtitles, data and metadata; mono 16 kHz', () => {
    const args = extractArgs('in.mp4', 'out.ogg', 'opus');
    for (const flag of ['-vn', '-sn', '-dn']) assert.ok(args.includes(flag));
    assert.deepEqual(args.slice(args.indexOf('-map_metadata'), args.indexOf('-map_metadata') + 2), ['-map_metadata', '-1']);
    assert.deepEqual(args.slice(args.indexOf('-ac'), args.indexOf('-ac') + 4), ['-ac', '1', '-ar', '16000']);
    assert.equal(CODECS.opus.bitrate, 24000);
    assert.throws(() => extractArgs('a', 'b', 'mp3'), /unknown codec/);
  });
});

describe('scoring (same measures as the on-device tables)', () => {
  test('Levenshtein split and matched pairs', () => {
    const e = errors(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    assert.deepEqual({ errors: e.errors, sub: e.sub, del: e.del, ins: e.ins }, { errors: 2, sub: 1, del: 0, ins: 1 });
    assert.deepEqual(e.pairs, [[0, 0], [2, 2], [3, 3]]);
  });
  test('strict WER, coverage, word timing, gap words, speakers', () => {
    const entry = {
      lang: 'en',
      reference: 'Hello there, world. Good night',
      words: [
        { w: 'Hello', s: 1.0, e: 1.4 },
        { w: 'there', s: 1.5, e: 1.9 },
        { w: 'world', s: 2.0, e: 2.5 },
        { w: 'good', s: 20.0, e: 20.4 },
        { w: 'night', s: 20.5, e: 21.0 },
      ],
      gaps: [{ start: 5, end: 15 }],
      expectedSpeakers: 2,
    };
    const transcript = {
      language_code: 'en',
      words: [
        { text: 'Hello', start: 1100, end: 1400, speaker: 'A' },
        { text: 'there,', start: 1500, end: 1900, speaker: 'A' },
        { text: 'World.', start: 2050, end: 2500, speaker: 'B' },
        { text: 'la', start: 10000, end: 10200, speaker: 'B' },
      ],
      utterances: [{ speaker: 'A' }, { speaker: 'B' }],
    };
    const score = scoreTranscript(entry, transcript);
    assert.equal(score.strict.refWords, 5);
    assert.equal(score.strict.errors, 2); // "good night" replaced by "la": 1 substitution + 1 deletion
    assert.equal(score.strict.wer, 0.4);
    assert.ok(Math.abs(score.coverage.written - 1.3 / 2.2) < 1e-9); // 1.3 s of 2.2 s of reference speech has returned words around it
    assert.equal(score.timing.start.n, 3);
    assert.ok(Math.abs(score.timing.start.p95AbsS - 0.1) < 1e-9);
    assert.equal(score.timing.start.within, 1);
    assert.deepEqual(score.gapWords, ['la']);
    assert.deepEqual(score.speakers, { found: 2, expected: 2, matches: true });
  });
  test('no reference → no accuracy numbers, speaker count only', () => {
    const score = scoreTranscript({ lang: null, reference: null, words: null, expectedSpeakers: null }, { words: [{ text: 'hi', start: 0, end: 100, speaker: 'A' }] });
    assert.equal(score.strict, null);
    assert.equal(score.speakers.found, 1);
  });
  test('Japanese is scored by characters', () => {
    const score = scoreTranscript({ lang: 'ja', reference: 'こんにちは 世界', words: null }, { words: [{ text: 'こんにちは', start: 0, end: 500 }, { text: '世間', start: 500, end: 900 }] });
    assert.equal(score.cer.refChars, 7);
    assert.equal(score.cer.errors, 1);
  });
});

describe('provider client against the local mock', () => {
  test('happy path: upload → create → poll (queued, processing, completed) → delete', async () => {
    const mock = await startMockProvider({ apiKey: KEY, pollsUntilDone: 2 });
    try {
      const client = createProviderClient({ baseUrl: mock.url, apiKey: KEY, ...fastClient });
      const uploadUrl = await client.upload(() => Buffer.from('OggS-fake-audio'));
      const created = await client.createTranscript(transcriptParams({ audioUrl: uploadUrl, models: ['universal-3-5-pro'], language: 'auto', speakerLabels: true }));
      const { transcript, polls } = await client.waitForTranscript(created.id, { intervalMs: 1 });
      assert.equal(polls, 3);
      assert.equal(transcript.status, 'completed');
      assert.equal(transcript.words.length, 2);
      await client.deleteTranscript(created.id);
      assert.equal(mock.state.transcripts.get(created.id).deleted, true);
      assert.equal(mock.state.uploads.size, 0, 'the uploaded file goes with the transcript');
      const sent = mock.state.transcripts.get(created.id).params;
      assert.deepEqual(sent.speech_models, ['universal-3-5-pro']);
      assert.equal(sent.language_detection, true);
      assert.equal(sent.language_code, undefined);
      assert.equal(sent.speaker_labels, true);
      assert.deepEqual(mock.state.requests.map((r) => `${r.method} ${r.path.replace(/[0-9a-f-]{36}/, ':id')}`), [
        'POST /v2/upload', 'POST /v2/transcript', 'GET /v2/transcript/:id', 'GET /v2/transcript/:id', 'GET /v2/transcript/:id', 'DELETE /v2/transcript/:id',
      ]);
      assert.equal(mock.state.requests[0].contentType, 'application/octet-stream');
    } finally {
      await mock.close();
    }
  });

  test('a fixed language sends language_code and no detection', () => {
    const params = transcriptParams({ audioUrl: 'u', models: ['universal-2'], language: 'tr', speakerLabels: false });
    assert.equal(params.language_code, 'tr');
    assert.equal(params.language_detection, undefined);
    assert.equal(params.speaker_labels, undefined);
  });

  test('rate limit: retries with the server\'s Retry-After, then succeeds', async () => {
    const mock = await startMockProvider({ apiKey: KEY, failUploads: 2, failStatus: 429, retryAfterS: 7 });
    const waits = [];
    try {
      const client = createProviderClient({ baseUrl: mock.url, apiKey: KEY, sleep: async (ms) => waits.push(ms) });
      await client.upload(() => Buffer.from('x'));
      assert.deepEqual(waits, [7000, 7000]);
      assert.equal(client.stats.retries, 2);
      assert.equal(mock.state.requests.length, 3);
    } finally {
      await mock.close();
    }
  });

  test('server errors: exponential backoff with jitter, capped, then gives up', async () => {
    const mock = await startMockProvider({ apiKey: KEY, failCreates: 99, failStatus: 503 });
    const waits = [];
    try {
      const client = createProviderClient({ baseUrl: mock.url, apiKey: KEY, sleep: async (ms) => waits.push(ms), maxAttempts: 4, backoffBaseMs: 1000, backoffMaxMs: 3000, random: () => 1 });
      const uploadUrl = await client.upload(() => Buffer.from('x'));
      await assert.rejects(client.createTranscript({ audio_url: uploadUrl }), (error) => error instanceof ProviderError && error.status === 503 && error.attempts === 4);
      assert.deepEqual(waits, [1000, 2000, 3000]);
    } finally {
      await mock.close();
    }
  });

  test('a wrong key is not retried and the key is not in the error', async () => {
    const mock = await startMockProvider({ apiKey: 'another-key', echoAuthInErrors: true });
    try {
      const client = createProviderClient({ baseUrl: mock.url, apiKey: KEY, ...fastClient });
      await assert.rejects(client.upload(() => Buffer.from('x')), (error) => error.status === 401 && error.code === 'unauthorized' && !error.message.includes(KEY) && error.message.includes(REDACTED));
      assert.equal(mock.state.requests.length, 1);
    } finally {
      await mock.close();
    }
  });

  test('a transcript that fails at the provider throws with the reason', async () => {
    const mock = await startMockProvider({ apiKey: KEY, pollsUntilDone: 1, transcriptError: 'Audio file does not appear to contain audio' });
    try {
      const client = createProviderClient({ baseUrl: mock.url, apiKey: KEY, ...fastClient });
      const uploadUrl = await client.upload(() => Buffer.from('x'));
      const created = await client.createTranscript({ audio_url: uploadUrl });
      await assert.rejects(client.waitForTranscript(created.id, { intervalMs: 1 }), /does not appear to contain audio/);
    } finally {
      await mock.close();
    }
  });

  test('polling stops at the timeout', async () => {
    const mock = await startMockProvider({ apiKey: KEY, pollsUntilDone: 1e9 });
    try {
      let clock = 0;
      const client = createProviderClient({ baseUrl: mock.url, apiKey: KEY, sleep: async (ms) => { clock += ms; } });
      const uploadUrl = await client.upload(() => Buffer.from('x'));
      const created = await client.createTranscript({ audio_url: uploadUrl });
      await assert.rejects(client.waitForTranscript(created.id, { intervalMs: 1000, timeoutMs: 5000, now: () => clock }), (error) => error.code === 'timeout');
    } finally {
      await mock.close();
    }
  });

  test('refuses the real provider without approval — before any request', () => {
    let called = 0;
    const fetchImpl = () => { called += 1; throw new Error('must not be called'); };
    for (const base of Object.values(PROVIDER_BASES)) {
      assert.throws(() => createProviderClient({ baseUrl: base, apiKey: KEY, fetchImpl }), (error) => error.code === 'not_approved');
    }
    assert.equal(called, 0);
  });
});

describe('command line', () => {
  test('default is a dry run: no network, the env file is never opened, exact files and cost are printed', async () => {
    // A directory as the env file: reading it would throw, so a dry run that touched it would fail.
    const { code, text } = await run(['smoke-fleurs-en', `--env-file=${scratch}`], { fetchImpl: noNetwork });
    assert.equal(code, EXIT.ok);
    assert.match(text, /DRY RUN/);
    assert.match(text, /smoke-fleurs-en\s+0:10/);
    assert.match(text, /web\/tests\/media\/speech-fleurs-en-01\.mp4/);
    assert.match(text, /estimated cost \$0\.0006/); // 10 s at $0.23/h
    assert.match(text, /ceiling --max-usd \$0\.5000/);
  });

  test('dry run over the whole set lists missing and private entries without opening them', async () => {
    const probed = [];
    const { code, text } = await run([], { fetchImpl: noNetwork, probe: (file) => { probed.push(file); return 9.6; }, hasAudio: () => true });
    assert.equal(code, EXIT.ok);
    assert.ok(probed.every((file) => !isPrivatePath(file)), 'a private file was probed');
    assert.match(text, /founder-real-1\s+private/);
    assert.match(text, /japanese-read\s+missing — needs a file/);
    assert.match(text, /two-speaker-overlap\s+missing — needs a file/);
  });

  test('the approval flag alone is not enough: a real run needs an explicit list', async () => {
    const { code, text } = await run(['--i-have-founder-approval', '--region=eu', `--env-file=${envFile}`], { fetchImpl: noNetwork, probe: () => 9.6, hasAudio: () => true });
    assert.equal(code, EXIT.usage);
    assert.match(text, /explicit list/);
  });

  test('a real run needs a region and a key; neither failure touches the network', async () => {
    const noRegion = await run(['--i-have-founder-approval', 'smoke-fleurs-en', `--env-file=${envFile}`], { fetchImpl: noNetwork });
    assert.equal(noRegion.code, EXIT.usage);
    assert.match(noRegion.text, /--region/);
    const noKey = await run(['--i-have-founder-approval', '--region=eu', 'smoke-fleurs-en', `--env-file=${join(scratch, 'missing.env')}`], { fetchImpl: noNetwork });
    assert.equal(noKey.code, EXIT.usage);
    assert.match(noKey.text, /no ASSEMBLYAI_API_KEY/);
  });

  test('--base-url accepts only a loopback address', async () => {
    const { code, text } = await run(['--base-url=https://api.assemblyai.com', 'smoke-fleurs-en'], { fetchImpl: noNetwork });
    assert.equal(code, EXIT.usage);
    assert.match(text, /only for a local mock/);
  });

  test('private files are refused (not probed, nothing sent) unless --allow-private', async () => {
    const privateDir = join(scratch, 'web', 'tests', 'media', 'real');
    mkdirSync(privateDir, { recursive: true });
    const privateFile = join(privateDir, 'family.mp4');
    writeFileSync(privateFile, 'not really a video');
    const mock = await startMockProvider({ apiKey: KEY });
    try {
      const probed = [];
      const deps = { probe: (file) => { probed.push(file); return 60; }, hasAudio: () => true };
      const refused = await run(['--i-have-founder-approval', `--base-url=${mock.url}`, `--env-file=${envFile}`, privateFile], deps);
      assert.equal(refused.code, EXIT.privateRefused);
      assert.match(refused.text, /refusing private file/);
      assert.equal(probed.length, 0);
      assert.equal(mock.state.requests.length, 0);
      const manifestId = await run(['--i-have-founder-approval', `--base-url=${mock.url}`, `--env-file=${envFile}`, 'founder-real-1'], deps);
      assert.equal(manifestId.code, EXIT.privateRefused);
      assert.equal(mock.state.requests.length, 0);
      // With the separate flag the file is accepted into the plan (dry run here: still nothing sent).
      const allowed = await run(['--allow-private', privateFile], { ...deps, fetchImpl: noNetwork });
      assert.equal(allowed.code, EXIT.ok);
      assert.match(allowed.text, /PRIVATE/);
      assert.equal(probed.length, 1);
    } finally {
      await mock.close();
    }
  });

  test('cost ceiling: the run aborts before any upload', async () => {
    const mock = await startMockProvider({ apiKey: KEY });
    try {
      const { code, text } = await run(['--i-have-founder-approval', `--base-url=${mock.url}`, `--env-file=${envFile}`, '--max-usd=0.0001', 'smoke-fleurs-en']);
      assert.equal(code, EXIT.overCeiling);
      assert.match(text, /ABORT/);
      assert.match(text, /Nothing was uploaded/);
      assert.equal(mock.state.requests.length, 0);
      // 3 hours at $0.23/h = $0.69 > the default $0.50
      const big = await run(['--i-have-founder-approval', `--base-url=${mock.url}`, `--env-file=${envFile}`, 'smoke-fleurs-en'], { probe: () => 3 * 3600 });
      assert.equal(big.code, EXIT.overCeiling);
      assert.equal(mock.state.requests.length, 0);
    } finally {
      await mock.close();
    }
  });
});

describe('a whole run against the local mock (real ffmpeg, the committed 9.6 s clip)', () => {
  const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && existsSync(speechFile);
  const reference = 'It was ruled by the "Vichy" French. These were French people who had made peace with the Germans in 1940 and worked with the invaders instead of fighting them.';
  const words = reference.split(' ').map((text, index) => ({ text, start: 300 * index, end: 300 * index + 250, speaker: 'A' }));

  test('upload is Ogg audio only, result is scored, transcript is deleted, the key appears nowhere', { skip: !ffmpeg && 'ffmpeg or the clip is not available' }, async () => {
    const mock = await startMockProvider({ apiKey: KEY, words, audioDurationS: 10, failUploads: 1, failStatus: 429 });
    const outDir = join(scratch, 'report-ok');
    try {
      const { code, text } = await run(['--i-have-founder-approval', `--base-url=${mock.url}`, `--env-file=${envFile}`, `--out=${outDir}`, '--poll-interval-ms=1', 'smoke-fleurs-en'], { normalise: () => null });
      assert.equal(code, EXIT.ok, text);
      const report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8'));
      const row = report.rows[0];
      const upload = mock.state.requests.filter((request) => request.path === '/v2/upload').pop();
      assert.equal(upload.head, 'OggS');
      assert.equal(row.bytesUploaded, upload.bytes);
      assert.ok(row.bytesUploaded < 60000, `a 9.6 s clip at 24 kbit/s is about 30 kB, got ${row.bytesUploaded}`);
      assert.ok(row.bytesUploaded < readFileSync(speechFile).length);
      assert.equal(row.score.strict.wer, 0);
      assert.deepEqual(row.score.speakers, { found: 1, expected: 1, matches: true });
      assert.equal(row.deleted, true);
      assert.equal(report.totals.deleted, 1);
      assert.equal(mock.state.requests.filter((request) => request.method === 'DELETE').length, 1);
      assert.equal(mock.state.uploads.size, 0);
      assert.equal(report.requests.retries, 1);
      assert.ok(Math.abs(row.costUsd - (10 / 3600) * 0.23) < 1e-12);
      assert.ok(row.wallS >= 0 && row.realTimeFactor >= 0);
      const markdown = readFileSync(join(outDir, 'report.md'), 'utf8');
      assert.match(markdown, /smoke-fleurs-en/);
      assert.match(markdown, /deleted at the provider afterwards: 1 of 1/);
      for (const blob of [text, markdown, JSON.stringify(report)]) assert.ok(!blob.includes(KEY), 'the key leaked');
      assert.equal(readdirSync(tmpdir()).filter((name) => name.startsWith('cloud-harness-') && !name.startsWith('cloud-harness-test-')).length, 0, 'temporary sound files were left behind');
    } finally {
      await mock.close();
    }
  });

  test('a provider that echoes the key in its errors: nothing we print or write contains it', { skip: !ffmpeg && 'ffmpeg or the clip is not available' }, async () => {
    const mock = await startMockProvider({ apiKey: KEY, echoAuthInErrors: true, failCreates: 99, failStatus: 500 });
    const outDir = join(scratch, 'report-err');
    try {
      const { code, text } = await run(['--i-have-founder-approval', `--base-url=${mock.url}`, `--env-file=${envFile}`, `--out=${outDir}`, 'smoke-fleurs-en'], { clientOptions: { maxAttempts: 2 }, normalise: () => null });
      assert.equal(code, EXIT.failed);
      assert.match(text, /FAILED/);
      assert.match(text, /HTTP 500/);
      const report = readFileSync(join(outDir, 'report.json'), 'utf8');
      assert.match(report, /REDACTED/);
      for (const blob of [text, report, readFileSync(join(outDir, 'report.md'), 'utf8')]) assert.ok(!blob.includes(KEY), 'the key leaked');
    } finally {
      await mock.close();
    }
  });

  test('a transcript that fails is still deleted at the provider', { skip: !ffmpeg && 'ffmpeg or the clip is not available' }, async () => {
    const mock = await startMockProvider({ apiKey: KEY, pollsUntilDone: 1, transcriptError: 'language_detection failed' });
    const outDir = join(scratch, 'report-fail');
    try {
      const { code } = await run(['--i-have-founder-approval', `--base-url=${mock.url}`, `--env-file=${envFile}`, `--out=${outDir}`, '--poll-interval-ms=1', 'smoke-fleurs-en'], { normalise: () => null });
      assert.equal(code, EXIT.failed);
      const report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8'));
      assert.match(report.rows[0].error, /language_detection failed/);
      assert.equal(report.rows[0].deleted, true);
      assert.equal(mock.state.requests.filter((request) => request.method === 'DELETE').length, 1);
    } finally {
      await mock.close();
    }
  });
});
