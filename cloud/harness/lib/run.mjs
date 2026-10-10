/**
 * The measurement run: plan → (dry run stops here) → sound-only files →
 * cost ceiling → upload → transcript → poll → result → delete at the provider →
 * score → report.
 *
 * Everything that can go wrong for free is checked BEFORE the first byte is
 * sent: approval flag, explicit file list, private files, missing files, the
 * key, the region and the cost ceiling.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { CODECS, extractAudio, hasAudio, probeDurationS, streamKinds } from './audio.mjs';
import { adHocEntry, defaultManifestFile, loadManifest, repoRoot, resolveEntry } from './manifest.mjs';
import { MODELS, PRICING, costUsd, formatUsd, hourlyRateUsd } from './pricing.mjs';
import { PROVIDER_BASES, createProviderClient, isLoopbackUrl, transcriptParams } from './provider.mjs';
import { normalisedEnglishWer, scoreTranscript } from './score.mjs';
import { KEY_NAME, readKeyFromEnvFile, redact, redactError } from './secrets.mjs';

export const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2, overCeiling: 3, privateRefused: 4 });
export const DEFAULT_MAX_USD = 0.5;
export const defaultEnvFile = resolve(repoRoot, 'cloud', '.env');

const USAGE = `
Provider measurement harness (cloud transcript route, ADR-039).

  node cloud/harness/run.mjs                       dry run over the whole measurement set
  node cloud/harness/run.mjs <id|file> ...         dry run over these entries / files
  node cloud/harness/run.mjs --i-have-founder-approval --region=eu <id|file> ...
                                                   REAL run: uploads sound, spends credit

Options
  --dry-run                    (default) print what would be uploaded and the estimated cost; no network, no key
  --i-have-founder-approval    allow a real run; needs an explicit list of ids/files and --region
  --allow-private              allow files under web/tests/media/real/ (the founder's own videos)
  --max-usd=<n>                hard ceiling, default ${DEFAULT_MAX_USD}; the run aborts before any upload if the estimate is above it
  --model=<a[,b]>              ${MODELS.join(' | ')} (default universal-3-5-pro)
  --language=<entry|auto|en|tr|ja|...>  default "entry": the entry's language, automatic detection if unknown
  --no-speaker-labels          do not ask for speaker labels (asked for by default; +$${PRICING.addOns.speakerLabels}/h)
  --codec=<${Object.keys(CODECS).join('|')}>            sound-only upload format (default opus, 24 kbit/s mono 16 kHz)
  --region=<us|eu>             provider region; no default for a real run
  --out=<dir>                  report folder (default cloud/harness/results/<time>/)
  --manifest=<file>            default cloud/harness/manifest.json
  --poll-interval-ms=<n>       default 3000
  --timeout-min=<n>            per file, default 60
`;

export function parseArgs(argv) {
  const options = {
    approval: false,
    dryRun: false,
    allowPrivate: false,
    maxUsd: DEFAULT_MAX_USD,
    models: ['universal-3-5-pro'],
    language: 'entry',
    speakerLabels: true,
    codec: 'opus',
    region: null,
    baseUrl: null,
    envFile: defaultEnvFile,
    out: null,
    manifest: defaultManifestFile,
    pollIntervalMs: 3000,
    timeoutMin: 60,
    help: false,
    targets: [],
  };
  for (const arg of argv) {
    const [name, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (!arg.startsWith('--')) options.targets.push(arg);
    else if (name === '--help') options.help = true;
    else if (name === '--dry-run') options.dryRun = true;
    else if (name === '--i-have-founder-approval') options.approval = true;
    else if (name === '--allow-private') options.allowPrivate = true;
    else if (name === '--no-speaker-labels') options.speakerLabels = false;
    else if (name === '--speaker-labels') options.speakerLabels = true;
    else if (name === '--max-usd') options.maxUsd = Number(value);
    else if (name === '--model') options.models = value.split(',').filter(Boolean);
    else if (name === '--language') options.language = value;
    else if (name === '--codec') options.codec = value;
    else if (name === '--region') options.region = value;
    else if (name === '--base-url') options.baseUrl = value;
    else if (name === '--env-file') options.envFile = resolve(value);
    else if (name === '--out') options.out = resolve(value);
    else if (name === '--manifest') options.manifest = resolve(value);
    else if (name === '--poll-interval-ms') options.pollIntervalMs = Number(value);
    else if (name === '--timeout-min') options.timeoutMin = Number(value);
    else throw new UsageError(`unknown option ${name}`);
  }
  if (!Number.isFinite(options.maxUsd) || options.maxUsd < 0) throw new UsageError('--max-usd must be a number ≥ 0');
  if (!CODECS[options.codec]) throw new UsageError(`--codec must be one of ${Object.keys(CODECS).join(', ')}`);
  hourlyRateUsd({ models: options.models }); // throws on a model without a documented price
  if (options.region !== null && !PROVIDER_BASES[options.region]) throw new UsageError('--region must be us or eu');
  if (options.baseUrl !== null && !isLoopbackUrl(options.baseUrl)) throw new UsageError('--base-url is only for a local mock (127.0.0.1 / localhost); use --region for the provider');
  // A real run only with the approval flag AND without --dry-run.
  options.real = options.approval && !options.dryRun;
  return options;
}

export class UsageError extends Error {}

const minutes = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const pct = (value) => (value === null || value === undefined || Number.isNaN(value) ? '—' : `${(value * 100).toFixed(1)}%`);
const ms = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 1000)} ms`);
const show = (file) => relative(repoRoot, file).split('\\').join('/') || file;

function languageFor(entry, options) {
  if (options.language === 'entry') return entry.lang ?? 'auto';
  return options.language;
}

/**
 * @param {string[]} argv
 * @param {object} [deps]  injected for tests: { out(line), fetchImpl, sleep, now, random, probe }
 * @returns {Promise<number>} exit code
 */
export async function main(argv, deps = {}) {
  const out = deps.out ?? ((line) => console.log(line));
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    out(`error: ${error.message}`);
    out(USAGE);
    return EXIT.usage;
  }
  if (options.help) {
    out(USAGE);
    return EXIT.ok;
  }
  const probe = deps.probe ?? probeDurationS;
  const rateOptions = { models: options.models, speakerLabels: options.speakerLabels };
  const rate = hourlyRateUsd(rateOptions);

  // ---------------------------------------------------------------- the plan
  const manifest = loadManifest(options.manifest);
  const byId = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const explicit = options.targets.length > 0;
  const entries = explicit
    ? options.targets.map((target) => (byId.has(target) ? resolveEntry(byId.get(target)) : adHocEntry(target)))
    : manifest.entries.map((entry) => resolveEntry(entry));

  if (options.real && !explicit) {
    out('error: a real run needs an explicit list of ids or files (nothing is uploaded "by default").');
    return EXIT.usage;
  }

  const refusedPrivate = entries.filter((entry) => entry.private && !options.allowPrivate);
  const plan = [];
  const skipped = [];
  for (const entry of entries) {
    if (entry.private && !options.allowPrivate) {
      skipped.push({ entry, why: 'private (founder\'s own video) — refused without --allow-private; not opened' });
      continue;
    }
    if (!entry.exists) {
      skipped.push({ entry, why: entry.status === 'missing-generate' ? `not on this machine — ${entry.howToGet ?? 'generate it first'}` : `missing — needs a file${entry.howToGet ? ` (${entry.howToGet})` : ''}` });
      continue;
    }
    if (!(deps.hasAudio ?? hasAudio)(entry.file)) {
      skipped.push({ entry, why: 'no audio stream' });
      continue;
    }
    const durationS = probe(entry.file);
    const spec = CODECS[options.codec];
    plan.push({
      entry,
      durationS,
      estimatedBytes: spec.bitrate ? Math.round((durationS * spec.bitrate) / 8) : null,
      estimatedUsd: costUsd(durationS, rateOptions),
      language: languageFor(entry, options),
    });
  }
  const totalS = plan.reduce((sum, item) => sum + item.durationS, 0);
  const totalUsd = plan.reduce((sum, item) => sum + item.estimatedUsd, 0);

  out(`${options.real ? 'REAL RUN' : 'DRY RUN — nothing is uploaded, no key is read, no network request is made'}`);
  out(`provider ${PRICING.provider}; model ${options.models.join(' → ')}; speaker labels ${options.speakerLabels ? 'on' : 'off'}; rate $${rate.toFixed(3)}/h (${PRICING.source}, read ${PRICING.readOn})`);
  out(`upload format: sound only, mono 16 kHz, ${options.codec}${CODECS[options.codec].bitrate ? ` ${CODECS[options.codec].bitrate / 1000} kbit/s` : ' (lossless)'} — the picture never leaves this machine`);
  out('');
  out(`would upload (${plan.length} file${plan.length === 1 ? '' : 's'}):`);
  for (const item of plan) {
    out(`  ${item.entry.id.padEnd(22)} ${minutes(item.durationS).padStart(7)}  ${item.estimatedBytes ? `~${(item.estimatedBytes / 1e6).toFixed(2)} MB` : 'size after encoding'}  ${formatUsd(item.estimatedUsd)}  lang=${item.language}${item.entry.private ? '  PRIVATE' : ''}  ${show(item.entry.file)}`);
  }
  if (skipped.length > 0) {
    out('');
    out('not in this run:');
    for (const item of skipped) out(`  ${item.entry.id.padEnd(22)} ${item.why}`);
  }
  out('');
  out(`total audio ${minutes(totalS)} (${(totalS / 3600).toFixed(3)} h) → estimated cost ${formatUsd(totalUsd)}; ceiling --max-usd ${formatUsd(options.maxUsd)}`);
  const toGenerate = skipped.filter((item) => item.entry.status === 'missing-generate' && item.entry.approxDurationS);
  if (!options.real && toGenerate.length > 0) {
    const extraS = toGenerate.reduce((sum, item) => sum + item.entry.approxDurationS, 0);
    out(`if the ${toGenerate.length} generated entries above were on this machine (lengths from the manifest, approximate): +${minutes(extraS)} → about ${formatUsd(costUsd(extraS, rateOptions))} more, ${formatUsd(totalUsd + costUsd(extraS, rateOptions))} in all`);
  }

  if (options.real && refusedPrivate.length > 0) {
    out(`error: refusing private file(s): ${refusedPrivate.map((entry) => entry.id).join(', ')}. They are the founder's own videos; pass --allow-private only with the founder's explicit decision.`);
    return EXIT.privateRefused;
  }
  if (totalUsd > options.maxUsd) {
    out(`ABORT: the estimate ${formatUsd(totalUsd)} is above the ceiling ${formatUsd(options.maxUsd)}. Nothing was uploaded. Give fewer files or raise --max-usd on purpose.`);
    return EXIT.overCeiling;
  }
  if (!options.real) {
    if (options.approval && options.dryRun) out('(--dry-run given together with the approval flag: staying dry.)');
    out('dry run finished. For the real run the founder adds --i-have-founder-approval, --region and the list of ids.');
    return refusedPrivate.length > 0 && explicit ? EXIT.privateRefused : EXIT.ok;
  }

  // ---------------------------------------------------------------- real run: last checks before any network
  if (skipped.length > 0) {
    out(`error: ${skipped.length} of the requested files cannot be used (see above); a real run needs every listed file.`);
    return EXIT.usage;
  }
  if (plan.length === 0) {
    out('error: nothing to upload.');
    return EXIT.usage;
  }
  if (!options.baseUrl && !options.region) {
    out('error: a real run needs --region=us or --region=eu (founder decision; see ADR-039).');
    return EXIT.usage;
  }
  const apiKey = readKeyFromEnvFile(options.envFile);
  if (!apiKey) {
    out(`error: no ${KEY_NAME} in ${show(options.envFile)} (the file is missing or the value is empty). Copy cloud/.env.example to cloud/.env and put the key there.`);
    return EXIT.usage;
  }
  const secrets = [apiKey];
  const safeOut = (line) => out(redact(line, secrets));
  const baseUrl = options.baseUrl ?? PROVIDER_BASES[options.region];
  const now = deps.now ?? Date.now;
  const workDir = mkdtempSync(join(tmpdir(), 'cloud-harness-'));
  const startedAt = new Date(now()).toISOString();
  const rows = [];
  let exitCode = EXIT.ok;
  try {
    // Sound-only files first: the exact duration and size are known before the ceiling is checked again.
    for (const item of plan) {
      const output = join(workDir, `${plan.indexOf(item)}.${CODECS[options.codec].ext}`);
      item.audio = (deps.extract ?? extractAudio)(item.entry.file, output, options.codec);
      item.kinds = (deps.streamKinds ?? streamKinds)(output);
      if (item.kinds.some((kind) => kind !== 'audio')) throw new Error(`${item.entry.id}: the extracted file has a non-audio stream (${item.kinds.join(', ')}); refusing to upload`);
      item.estimatedUsd = costUsd(item.audio.durationS, rateOptions);
    }
    const exactUsd = plan.reduce((sum, item) => sum + item.estimatedUsd, 0);
    const exactBytes = plan.reduce((sum, item) => sum + item.audio.bytes, 0);
    safeOut(`sound-only files ready: ${(exactBytes / 1e6).toFixed(2)} MB in total; cost at the exact durations ${formatUsd(exactUsd)}`);
    if (exactUsd > options.maxUsd) {
      safeOut(`ABORT: ${formatUsd(exactUsd)} is above the ceiling ${formatUsd(options.maxUsd)}. Nothing was uploaded.`);
      return EXIT.overCeiling;
    }

    const client = createProviderClient({
      baseUrl,
      apiKey,
      approved: options.approval,
      fetchImpl: deps.fetchImpl ?? fetch,
      sleep: deps.sleep,
      random: deps.random,
      log: safeOut,
      ...(deps.clientOptions ?? {}),
    });

    let spentUsd = 0;
    for (const item of plan) {
      const row = {
        id: item.entry.id,
        category: item.entry.category,
        private: item.entry.private,
        language: item.language,
        durationS: item.audio.durationS,
        bytesUploaded: 0,
        codec: options.codec,
        transcriptId: null,
        deleted: false,
        deleteError: null,
        error: null,
      };
      rows.push(row);
      if (spentUsd + item.estimatedUsd > options.maxUsd) {
        row.error = 'not sent: the ceiling would be passed';
        exitCode = EXIT.overCeiling;
        continue;
      }
      const t0 = now();
      try {
        const uploadUrl = await client.upload(() => readFileSync(item.audio.file));
        row.bytesUploaded = item.audio.bytes;
        const tUploaded = now();
        const created = await client.createTranscript(
          transcriptParams({ audioUrl: uploadUrl, models: options.models, language: item.language, speakerLabels: options.speakerLabels }),
        );
        row.transcriptId = created.id;
        const { transcript, polls } = await client.waitForTranscript(created.id, { intervalMs: options.pollIntervalMs, timeoutMs: options.timeoutMin * 60000, now });
        const tDone = now();
        row.polls = polls;
        row.uploadS = (tUploaded - t0) / 1000;
        row.wallS = (tDone - t0) / 1000;
        row.realTimeFactor = row.wallS / item.audio.durationS;
        row.providerDurationS = transcript.audio_duration ?? null;
        row.costUsd = costUsd(transcript.audio_duration ?? item.audio.durationS, rateOptions);
        row.modelUsed = transcript.speech_model_used ?? transcript.speech_model ?? null;
        spentUsd += row.costUsd;
        row.score = scoreTranscript(item.entry, transcript);
        row.hypothesisText = (transcript.words ?? []).map((word) => word.text).join(' ');
        if (!item.entry.private) row.transcript = { text: transcript.text ?? null, words: transcript.words ?? [], utterances: transcript.utterances ?? null, language_code: transcript.language_code ?? null };
        safeOut(`  ${row.id}: done in ${row.wallS.toFixed(1)} s (×${row.realTimeFactor.toFixed(3)} of real time), ${formatUsd(row.costUsd)}`);
      } catch (error) {
        const safe = redactError(error, secrets);
        row.error = safe.message;
        exitCode = EXIT.failed;
        safeOut(`  ${row.id}: FAILED — ${safe.message}`);
      } finally {
        // Whatever happened, the transcript (and with it the uploaded file) is removed at the provider.
        if (row.transcriptId) {
          try {
            const answer = await client.deleteTranscript(row.transcriptId);
            row.deleted = true;
            row.deleteStatus = answer?.status ?? null;
          } catch (error) {
            row.deleteError = redactError(error, secrets).message;
            exitCode = EXIT.failed;
            safeOut(`  ${row.id}: COULD NOT DELETE transcript ${row.transcriptId} at the provider — ${row.deleteError}. Delete it by hand in the provider's dashboard.`);
          }
        }
      }
    }

    // The normalised English measure, one Python call for every English row.
    const english = rows.filter((row) => row.score?.strict && (row.score.lang ?? 'en') === 'en');
    const normalised = (deps.normalise ?? normalisedEnglishWer)(
      english.map((row) => ({ reference: plan.find((item) => item.entry.id === row.id).entry.reference, hypothesis: row.hypothesisText })),
    );
    english.forEach((row, index) => {
      row.score.normalised = normalised ? normalised[index] : null;
    });
    for (const row of rows) delete row.hypothesisText;

    const report = {
      createdAt: startedAt,
      provider: PRICING.provider,
      region: options.baseUrl ? `local mock (${new URL(baseUrl).host})` : options.region,
      models: options.models,
      speakerLabels: options.speakerLabels,
      codec: options.codec,
      pricing: { ratePerHourUsd: rate, source: PRICING.source, readOn: PRICING.readOn },
      maxUsd: options.maxUsd,
      totals: {
        files: rows.length,
        audioS: rows.reduce((sum, row) => sum + row.durationS, 0),
        bytesUploaded: rows.reduce((sum, row) => sum + row.bytesUploaded, 0),
        costUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
        deleted: rows.filter((row) => row.deleted).length,
        created: rows.filter((row) => row.transcriptId).length,
        failed: rows.filter((row) => row.error).length,
      },
      requests: client.stats,
      normalisedMeasure: normalised ? 'computed (web/spike/asr/normalize_en.py)' : 'not computed (no scoring venv at web/spike/asr/.venv)',
      rows,
    };
    const outDir = options.out ?? join(repoRoot, 'cloud', 'harness', 'results', startedAt.replace(/[:.]/g, '-'));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'report.json'), `${redact(JSON.stringify(report, null, 1), secrets)}\n`);
    writeFileSync(join(outDir, 'report.md'), `${redact(renderMarkdown(report), secrets)}\n`);
    safeOut('');
    safeOut(`report: ${show(join(outDir, 'report.md'))} and report.json`);
    safeOut(`spent ${formatUsd(report.totals.costUsd)}; transcripts deleted at the provider: ${report.totals.deleted} of ${report.totals.created}`);
    return exitCode;
  } catch (error) {
    safeOut(`error: ${redactError(error, secrets).message}`);
    return EXIT.failed;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function renderMarkdown(report) {
  const lines = [
    `# Cloud transcript measurement — ${report.provider}`,
    '',
    `- Run: ${report.createdAt}; region ${report.region}; model ${report.models.join(' → ')}; speaker labels ${report.speakerLabels ? 'on' : 'off'}`,
    `- Upload: sound only, mono 16 kHz, ${report.codec}; ${(report.totals.bytesUploaded / 1e6).toFixed(2)} MB for ${(report.totals.audioS / 60).toFixed(1)} minutes`,
    `- Price used: $${report.pricing.ratePerHourUsd.toFixed(3)}/h (${report.pricing.source}, read ${report.pricing.readOn}); spent ${formatUsd(report.totals.costUsd)} (ceiling ${formatUsd(report.maxUsd)})`,
    `- Transcripts deleted at the provider afterwards: ${report.totals.deleted} of ${report.totals.created}`,
    `- Requests ${report.requests.requests}, retries ${report.requests.retries}`,
    `- Normalised English WER: ${report.normalisedMeasure}`,
    '',
    'WER strict = the ADR-017 measure (web/spike/asr/metrics.mjs). "Speech written" = share of the reference words\' own time that falls inside a run of returned words (gaps ≤ 1.0 s, ±0.25 s) — the provider returns words, not spans, so this is the closest equivalent of the on-device column, not the same rule. Word timing: matched words only.',
    '',
    '| File | Lang (detected) | Length | WER normalised | WER strict | Deleted words | Speech written | Start err. median / p95 (≤250 ms) | End err. median / p95 (≤250 ms) | Speakers found / expected | Wall time | × real time | Uploaded | Cost | Deleted |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of report.rows) {
    if (row.error && !row.score) {
      lines.push(`| ${row.id} | ${row.language} | ${minutes(row.durationS)} | FAILED: ${row.error.replace(/\|/g, '/')} | | | | | | | | | ${(row.bytesUploaded / 1e6).toFixed(2)} MB | | ${row.transcriptId ? (row.deleted ? 'yes' : 'NO') : 'n/a'} |`);
      continue;
    }
    const s = row.score ?? {};
    const accuracy = s.cer ? `CER ${pct(s.cer.rate)}` : pct(s.strict?.wer);
    const timing = (t) => (t ? `${ms(t.medianAbsS)} / ${ms(t.p95AbsS)} (${pct(t.within)})` : '—');
    lines.push(
      `| ${row.id}${row.private ? ' (private)' : ''} | ${row.language} (${s.detectedLanguage ?? '—'}) | ${minutes(row.durationS)} | ${s.normalised ? pct(s.normalised.wer) : '—'} | ${accuracy} | ${pct(s.strict?.deletedShare)} | ${pct(s.coverage?.written)} | ${timing(s.timing?.start)} | ${timing(s.timing?.end)} | ${s.speakers ? `${s.speakers.found} / ${s.speakers.expected ?? '?'}` : '—'} | ${row.wallS?.toFixed(1) ?? '—'} s | ${row.realTimeFactor?.toFixed(3) ?? '—'} | ${(row.bytesUploaded / 1e6).toFixed(2)} MB | ${row.costUsd === undefined ? '—' : formatUsd(row.costUsd)} | ${row.deleted ? 'yes' : 'NO'} |`,
    );
  }
  const gaps = report.rows.filter((row) => row.score?.gapWords?.length > 0);
  if (gaps.length > 0) lines.push('', `Words written inside marked non-speech gaps: ${gaps.map((row) => `${row.id}: ${row.score.gapWords.length}`).join('; ')}`);
  return lines.join('\n');
}
