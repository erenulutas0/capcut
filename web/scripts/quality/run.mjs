/**
 * `npm run quality` — the quality measurement layer (docs/quality/README.md).
 *
 * Builds what people get (the static export) and, for the one flow that
 * needs a stand-in recogniser, the test-hooks build; serves them on this
 * script's own port; runs the measurements of tests/quality under the
 * machine-wide measure lock; judges the numbers against budgets.json; and
 * writes docs/quality/latest.md, latest.json and a line of history.jsonl.
 *
 *   node scripts/quality/run.mjs                      everything (transcript: recorded numbers only)
 *   node scripts/quality/run.mjs --only=search,text   some sections
 *   node scripts/quality/run.mjs --skip=output        all but some
 *   node scripts/quality/run.mjs --no-build           reuse out/ and .next/ as they are
 *   node scripts/quality/run.mjs --with-transcript    also re-measure the transcript (needs public/models)
 *   node scripts/quality/run.mjs --update-baselines   accept the screens as they look now
 *   node scripts/quality/run.mjs --report-only        rebuild the report from the last results
 *   node scripts/quality/run.mjs --no-history         do not add a line to history.jsonl (trial runs)
 *   node scripts/quality/run.mjs --no-gate            exit 0 even when a budget is exceeded
 *   node scripts/quality/run.mjs --only=output --grep=kes-goruntu   one measurement of a section
 *
 * Nothing leaves the machine: local servers on 127.0.0.1, synthetic media.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquire, release } from '../lib/measure-lock.mjs';
import { writeReport } from './report.mjs';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scratch = join(webDir, '.scratch', 'quality');
const resultsDir = join(scratch, 'results');
const PORT = Number(process.env.QUALITY_PORT ?? 3195);

const flags = new Set(process.argv.slice(2).filter((a) => !a.includes('=')));
const option = (name) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3).split(',').filter(Boolean) : null;
};

/**
 * Every section: which result files it owns, and what has to run for it.
 * `build`: 'static' = the export people get, 'hooks' = the CLIP_TEST_HOOKS=1
 * build (stand-in recogniser), 'none' = no browser page at all.
 */
export const SECTIONS = [
  { id: 'walkthrough', results: ['walkthrough', 'walkthrough-yazi'], runs: [
    { build: 'hooks', spec: 'walkthrough-yazi.spec.ts', projects: ['desktop', 'phone'] },
    { build: 'static', spec: 'walkthrough.spec.ts', projects: ['desktop', 'phone'] },
  ] },
  { id: 'search', results: ['search'], runs: [{ build: 'none', spec: 'search.spec.ts', projects: ['desktop'] }] },
  { id: 'errors', results: ['errors'], runs: [{ build: 'static', spec: 'errors.spec.ts', projects: ['desktop'] }] },
  { id: 'honesty', results: ['honesty'], runs: [{ build: 'static', spec: 'honesty.spec.ts', projects: ['desktop'] }] },
  { id: 'output', results: ['output'], runs: [{ build: 'static', spec: 'output.spec.ts', projects: ['desktop'] }] },
  { id: 'transcript', results: ['transcript'], optIn: 'with-transcript', runs: [{ build: 'static', spec: 'transcript.spec.ts', projects: ['desktop'] }] },
  { id: 'perf', results: ['perf'], runs: [{ build: 'static', spec: 'perf.spec.ts', projects: ['desktop'] }] },
  { id: 'visual', results: ['visual'], runs: [{ build: 'static', spec: 'visual.spec.ts', projects: ['desktop', 'phone'] }] },
  { id: 'a11y', results: ['a11y'], runs: [{ build: 'static', spec: 'a11y.spec.ts', projects: ['desktop', 'phone'] }] },
  { id: 'text', results: ['text'], runs: [{ build: 'none', spec: 'text.spec.ts', projects: ['desktop'] }] },
];

function selected() {
  const only = option('only');
  const skip = option('skip') ?? [];
  const known = new Set(SECTIONS.map((section) => section.id));
  for (const id of [...(only ?? []), ...skip]) {
    if (!known.has(id)) {
      console.error(`quality: unknown section "${id}" (sections: ${[...known].join(', ')})`);
      process.exit(2);
    }
  }
  return SECTIONS.filter((section) => {
    if (skip.includes(section.id)) return false;
    if (only) return only.includes(section.id);
    return !section.optIn || flags.has(`--${section.optIn}`);
  });
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: webDir, stdio: 'inherit', env: { ...process.env, ...env }, shell: false });
  return result.status ?? 1;
}

function npmRunBuild(env) {
  // npm is a .cmd on Windows: it needs a shell there.
  const result = spawnSync('npm run build', { cwd: webDir, stdio: 'inherit', env: { ...process.env, ...env }, shell: true });
  return result.status ?? 1;
}

/** Whatever still listens on our port from an earlier run is stopped first. */
function freePort() {
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).stdout ?? '';
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts[1]?.endsWith(`:${PORT}`) && parts[3] === 'LISTENING') pids.add(parts[4]);
    }
    for (const pid of pids) {
      console.log(`quality: stopping a stale listener on port ${PORT} (pid ${pid})`);
      spawnSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
    }
  } else {
    const out = spawnSync('lsof', ['-ti', `tcp:${PORT}`], { encoding: 'utf8' }).stdout ?? '';
    for (const pid of out.split(/\s+/).filter(Boolean)) spawnSync('kill', ['-9', pid]);
  }
}

async function startServer(build) {
  freePort();
  mkdirSync(scratch, { recursive: true });
  const log = openSync(join(scratch, `server-${build}.log`), 'w');
  const args =
    build === 'static'
      ? [join('scripts', 'serve-static.mjs'), '--dir=out', '--base=', `--port=${PORT}`, '--gzip']
      : [join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)];
  const child = spawn(process.execPath, args, { cwd: webDir, stdio: ['ignore', log, log] });
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) throw new Error(`the ${build} server stopped (see .scratch/quality/server-${build}.log)`);
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`the ${build} server did not answer on port ${PORT}`);
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((done) => {
    child.once('exit', done);
    child.kill();
    setTimeout(done, 5000);
  });
  freePort();
}

function playwright(specs, projects, build) {
  const args = [
    join('node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '-c',
    'playwright.quality.config.ts',
    ...specs.map((spec) => join('tests', 'quality', spec).replace(/\\/g, '/')),
    ...projects.map((project) => `--project=${project}`),
  ];
  // --grep=<text>: only the measurements whose name contains it (for looking into one case).
  const grep = option('grep');
  if (grep) args.push('-g', grep.join(','));
  return run(process.execPath, args, {
    QUALITY_BUILD: build,
    QUALITY_PORT: String(PORT),
    QUALITY_UPDATE_BASELINES: flags.has('--update-baselines') ? '1' : '',
    QUALITY_WITH_TRANSCRIPT: flags.has('--with-transcript') ? '1' : '',
  });
}

function clearResults(sections) {
  mkdirSync(resultsDir, { recursive: true });
  const has = (id) => sections.some((section) => section.id === id);
  const owned = new Set(sections.flatMap((section) => section.results).filter((name) => name !== 'visual'));
  for (const name of readdirSync(resultsDir)) {
    if (owned.has(name.split('.')[0])) rmSync(join(resultsDir, name));
    // Screens are photographed by the walkthroughs too: a run of either renews its own pictures' results.
    else if (name.startsWith('visual.') && (name.includes('.walkthrough') ? has('walkthrough') : has('visual'))) rmSync(join(resultsDir, name));
  }
  // Diff pictures of screens that are compared again are made again.
  const diffs = join(scratch, 'visual-diffs');
  if (existsSync(diffs)) {
    for (const name of readdirSync(diffs)) {
      // The walkthroughs' pictures are named "yol-…"; the rest belong to the visual section.
      if (name.startsWith('yol-') ? has('walkthrough') : has('visual')) rmSync(join(diffs, name));
    }
  }
}

const sections = selected();
const started = Date.now();
const ran = [];
const failed = [];
let locked = false;
let server = null;

const giveBack = () => {
  if (locked) {
    locked = false;
    release();
  }
};
process.on('SIGINT', () => {
  server?.kill();
  giveBack();
  process.exit(130);
});

if (!flags.has('--report-only')) {
  const builds = new Set(sections.flatMap((section) => section.runs.map((item) => item.build)));
  if (!flags.has('--no-build')) {
    // The export first: it leaves out/ behind; the hooks build then owns .next/.
    if (builds.has('static')) {
      console.log('quality: building the static export (what people get)');
      rmSync(join(webDir, 'out'), { recursive: true, force: true });
      if (npmRunBuild({ STATIC_EXPORT: '1', NEXT_PUBLIC_BASE_PATH: '', CLIP_TEST_HOOKS: '' }) !== 0) process.exit(1);
    }
    if (builds.has('hooks')) {
      console.log('quality: building with test hooks (stand-in recogniser; never published)');
      if (npmRunBuild({ STATIC_EXPORT: '', NEXT_PUBLIC_BASE_PATH: '', CLIP_TEST_HOOKS: '1' }) !== 0) process.exit(1);
    }
  }
  if (builds.has('static') && !existsSync(join(webDir, 'out', 'index.html'))) {
    console.error('quality: out/ is missing — run without --no-build');
    process.exit(1);
  }
  // With --grep only some measurements run: the others' results stay.
  if (!option('grep')) clearResults(sections);

  try {
    if (builds.has('static') || builds.has('hooks')) {
      await acquire(`quality runner (${sections.map((section) => section.id).join(', ')})`);
      locked = true;
    }
    for (const build of ['none', 'hooks', 'static']) {
      const jobs = sections.flatMap((section) => section.runs.filter((item) => item.build === build).map((item) => ({ section: section.id, ...item })));
      if (jobs.length === 0) continue;
      if (build !== 'none') server = await startServer(build);
      try {
        for (const job of jobs) {
          console.log(`\nquality: ${job.section} — ${job.spec} [${job.projects.join(', ')}] on the ${build} build`);
          const status = playwright([job.spec], job.projects, build);
          ran.push(job.section);
          if (status !== 0) failed.push(`${job.section} (${job.spec})`);
        }
      } finally {
        await stopServer(server);
        server = null;
      }
    }
  } finally {
    giveBack();
  }
}

const outcome = writeReport({
  webDir,
  resultsDir,
  ran: [...new Set(ran)],
  failedSpecs: failed,
  runSeconds: Math.round((Date.now() - started) / 1000),
  history: !flags.has('--no-history') && !flags.has('--report-only'),
  updatedBaselines: flags.has('--update-baselines'),
});

console.log(`\nquality: report written to ${outcome.markdown}`);
console.log(`quality: ${outcome.counts.ok} within budget, ${outcome.counts.over} over budget, ${outcome.counts.unmeasured} not measured, ${outcome.counts.info} without a budget`);
if (failed.length > 0) console.log(`quality: measurement specs that did not finish cleanly: ${failed.join('; ')}`);
if (!flags.has('--no-gate') && (outcome.counts.over > 0 || failed.length > 0)) process.exit(1);
