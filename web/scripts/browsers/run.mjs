/**
 * `npm run browsers` — the other-engines suite (docs/quality/README.md):
 * Firefox and WebKit (and Chromium as the control), desktop and phone-sized,
 * against the build people get (`npm run build` + `next start`).
 *
 *   node scripts/browsers/run.mjs                         build, run everything, write the report
 *   node scripts/browsers/run.mjs --no-build              reuse .next/ (it must be a plain build)
 *   node scripts/browsers/run.mjs --project=firefox-desktop,webkit-phone
 *   node scripts/browsers/run.mjs --grep=kart             only tests whose title matches
 *   node scripts/browsers/run.mjs --report-only           rebuild the report from the last results
 *
 * Not part of the default e2e run and not a CI gate. Needs the engines once:
 * `npx playwright install firefox webkit`. Nothing leaves the machine.
 *
 * Exits 1 when a row is "broken" (a fake success, a wait that never ends, an
 * error nobody was told about). A browser that cannot do a job and says so
 * is not a failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquire, release } from '../lib/measure-lock.mjs';
import { writeBrowsersReport } from './report.mjs';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const resultsDir = join(webDir, '.scratch', 'browsers', 'results');
const PORT = Number(process.env.BROWSERS_PORT ?? 3196);
const BUILD_MARK = join(webDir, '.next', 'quality-build.txt');

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => !arg.includes('=')));
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

/** Whatever still listens on our port from an earlier run is stopped first, and again at the end. */
function freePort() {
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).stdout ?? '';
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts[1]?.endsWith(`:${PORT}`) && parts[3] === 'LISTENING') pids.add(parts[4]);
    }
    for (const pid of pids) {
      console.log(`browsers: stopping a listener on port ${PORT} (pid ${pid})`);
      spawnSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
    }
  } else {
    const out = spawnSync('lsof', ['-ti', `tcp:${PORT}`], { encoding: 'utf8' }).stdout ?? '';
    for (const pid of out.split(/\s+/).filter(Boolean)) spawnSync('kill', ['-9', pid]);
  }
}

if (flags.has('--report-only')) {
  const report = writeBrowsersReport();
  console.log(`browsers: ${report.file} (${report.cells} satır, ${report.broken} bozuk)`);
  process.exit(0);
}

if (!flags.has('--no-build')) {
  console.log('browsers: building what people get (plain `npm run build`: no test hooks, no cloud route)');
  // npm is a .cmd on Windows: it needs a shell there.
  const built = spawnSync('npm run build', {
    cwd: webDir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, STATIC_EXPORT: '', NEXT_PUBLIC_BASE_PATH: '', CLIP_TEST_HOOKS: '', NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL: '' },
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
  // The quality runner reuses .next/ only when this file names its build: tell it this one is neither.
  writeFileSync(BUILD_MARK, 'plain\n');
} else if (!existsSync(join(webDir, '.next', 'BUILD_ID'))) {
  console.error('browsers: --no-build, but there is no .next/ build');
  process.exit(2);
} else if (existsSync(BUILD_MARK) && readFileSync(BUILD_MARK, 'utf8').trim() !== 'plain') {
  console.error(`browsers: .next/ holds the "${readFileSync(BUILD_MARK, 'utf8').trim()}" build (test hooks); run without --no-build`);
  process.exit(2);
}

const projects = option('project')?.split(',').filter(Boolean) ?? [];
const grep = option('grep');
// A partial run keeps the other rows; a whole run starts from nothing, so no old row passes for a new one.
if (projects.length === 0 && !grep) rmSync(resultsDir, { recursive: true, force: true });
else if (existsSync(resultsDir) && projects.length > 0 && !grep) {
  for (const name of readdirSync(resultsDir)) {
    if (projects.some((project) => name.startsWith(`${project}.`))) rmSync(join(resultsDir, name), { force: true });
  }
}

const playwrightArgs = ['playwright', 'test', '-c', 'playwright.browsers.config.ts'];
for (const project of projects) playwrightArgs.push(`--project=${project}`);
if (grep) playwrightArgs.push('-g', grep);

await acquire(`browsers suite | port ${PORT}`);
let status = 1;
try {
  freePort();
  const ran = spawnSync(`npx ${playwrightArgs.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')}`, {
    cwd: webDir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, BROWSERS_PORT: String(PORT) },
  });
  status = ran.status ?? 1;
} finally {
  freePort();
  release();
}

const report = writeBrowsersReport();
console.log(`browsers: ${report.file} (${report.cells} satır, ${report.broken} bozuk)`);
process.exit(status === 0 && report.broken === 0 ? 0 : 1);
