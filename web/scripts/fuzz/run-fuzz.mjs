/**
 * The fuzz run (docs/quality/README.md, "Dosya fuzz koşusu"; report:
 * docs/quality/2026-10-15-fuzz.md).
 *
 * Makes the corpus (scripts/fuzz/make-corpus.mjs), builds the test-hooks
 * server build (the stand-in recogniser for "Yazıya dök"; the cloud route
 * off), serves it with `next start` on this script's own port, opens every
 * corpus file on every task card and in the editor (tests/fuzz/fuzz.spec.ts)
 * under the machine-wide measure lock — released between batches — and
 * writes the cell table.
 *
 *   node scripts/fuzz/run-fuzz.mjs                        everything (about 1–2 hours)
 *   node scripts/fuzz/run-fuzz.mjs --no-build             reuse .next/ as it is (must be the test-hooks build)
 *   node scripts/fuzz/run-fuzz.mjs --no-corpus            reuse the corpus as it is
 *   node scripts/fuzz/run-fuzz.mjs --surfaces=kes,editor  some cards (ids of /yap/<id>/, or editor)
 *   node scripts/fuzz/run-fuzz.mjs --files=temel,avi      some corpus files (ids of the manifest)
 *   node scripts/fuzz/run-fuzz.mjs --report-only          rewrite the report from the last results
 *   node scripts/fuzz/run-fuzz.mjs --keep-results         do not clear the result cells of the selection first
 *
 * Writes web/.scratch/fuzz/report.md (the cell table, the findings, every
 * screen text) and report.json. Not in CI and not part of `npm run quality`.
 * Nothing leaves the machine: a local server on 127.0.0.1, synthetic media.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquire, release } from '../lib/measure-lock.mjs';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scratch = join(webDir, '.scratch', 'fuzz');
const resultsDir = join(scratch, 'results');
const corpusDir = process.env.FUZZ_CORPUS ?? join(scratch, 'corpus');
const PORT = Number(process.env.FUZZ_PORT ?? 3194);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => !a.includes('=')));
const option = (name) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3).split(',').filter(Boolean) : null;
};

const TASKS = ['kes', 'bosluk', 'dikey', 'kucult', 'yazi', 'muzik', 'ses', 'sustur', 'cevir', 'iyilestir'];
const SURFACES = [...TASKS, 'editor'];
const SURFACE_LABEL = {
  kes: 'Kes', bosluk: 'Boşlukları at', dikey: 'Dikey yap', kucult: 'Küçült', yazi: 'Yazıya dök', muzik: 'Müzik ekle',
  ses: 'Sesini al', sustur: 'Sesi kapat', cevir: 'Her yerde açılsın', iyilestir: 'İyileştir', editor: 'Editör',
};
/** One Playwright run per batch; the lock is given back between them so another run on this machine gets a turn. */
const BATCHES = [['kes', 'bosluk', 'dikey', 'kucult'], ['yazi', 'muzik', 'ses', 'sustur'], ['cevir', 'iyilestir', 'editor']];

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, { cwd: webDir, stdio: 'inherit', env: { ...process.env, ...env }, shell: false });
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
      console.log(`fuzz: stopping a stale listener on port ${PORT} (pid ${pid})`);
      spawnSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
    }
  } else {
    const out = spawnSync('lsof', ['-ti', `tcp:${PORT}`], { encoding: 'utf8' }).stdout ?? '';
    for (const pid of out.split(/\s+/).filter(Boolean)) spawnSync('kill', ['-9', pid]);
  }
}

function build() {
  console.log('fuzz: building with test hooks (stand-in recogniser; the cloud route off; never published)');
  // npm is a .cmd on Windows: it needs a shell there.
  const result = spawnSync('npm run build', {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, STATIC_EXPORT: '', NEXT_PUBLIC_BASE_PATH: '', CLIP_TEST_HOOKS: '1', NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL: '' },
    shell: true,
  });
  if ((result.status ?? 1) !== 0) process.exit(1);
}

async function startServer() {
  freePort();
  mkdirSync(scratch, { recursive: true });
  const log = openSync(join(scratch, 'server.log'), 'w');
  const child = spawn(process.execPath, [join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(PORT)], { cwd: webDir, stdio: ['ignore', log, log] });
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) throw new Error('the server stopped (see .scratch/fuzz/server.log)');
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`the server did not answer on port ${PORT}`);
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

function playwright(surfaces, files) {
  const grep = `^fuzz: (${surfaces.join('|')}) ×`;
  const cli = join('node_modules', '@playwright', 'test', 'cli.js');
  return run(process.execPath, [cli, 'test', '-c', 'playwright.fuzz.config.ts', '-g', grep], {
    FUZZ_PORT: String(PORT),
    FUZZ_CORPUS: corpusDir,
    FUZZ_SURFACES: surfaces.join(','),
    FUZZ_FILES: files ? files.join(',') : '',
  });
}

function clearResults(surfaces, files) {
  mkdirSync(resultsDir, { recursive: true });
  for (const name of readdirSync(resultsDir)) {
    const [surface, ...rest] = name.replace(/\.json$/, '').split('.');
    const id = rest.join('.');
    if (surfaces.includes(surface) && (!files || files.includes(id))) rmSync(join(resultsDir, name));
  }
}

// ------------------------------------------------------------ the report

function readCells() {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(resultsDir, name), 'utf8')))
    .map((record) => ({ ...record.data, surface: record.surface, id: record.id, measuredAt: record.measuredAt }));
}

const tr = (value, digits = 1) => Number(value).toLocaleString('tr-TR', { maximumFractionDigits: digits });
const cellText = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function writeReport() {
  const manifest = existsSync(join(corpusDir, 'manifest.json')) ? JSON.parse(readFileSync(join(corpusDir, 'manifest.json'), 'utf8')) : { items: [] };
  const cells = readCells();
  const items = manifest.items.filter((item) => cells.some((cell) => cell.id === item.id));
  const surfaces = SURFACES.filter((surface) => cells.some((cell) => cell.surface === surface));
  const at = (surface, id) => cells.find((cell) => cell.surface === surface && cell.id === id) ?? null;
  const counts = { iyi: 0, belirsiz: 0, bozuk: 0, 'ölçülemedi': 0 };
  for (const cell of cells) counts[cell.verdict] = (counts[cell.verdict] ?? 0) + 1;
  const outcomes = {};
  for (const cell of cells) outcomes[cell.outcome ?? 'yok'] = (outcomes[cell.outcome ?? 'yok'] ?? 0) + 1;
  const longest = Math.max(0, ...cells.map((cell) => cell.longestUnresponsiveMs ?? 0));
  const withPageErrors = cells.filter((cell) => (cell.pageErrors ?? []).length > 0).length;
  const withConsoleErrors = cells.filter((cell) => (cell.consoleErrors ?? []).length > 0).length;
  const withRejections = cells.filter((cell) => (cell.unhandledRejections ?? []).length > 0).length;
  const withWatchdog = cells.filter((cell) => (cell.watchdogReloads ?? 0) > 0).length;
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: webDir, encoding: 'utf8' }).stdout?.trim() ?? '?';
  const measuredAt = cells.map((cell) => cell.measuredAt).sort().at(-1) ?? null;

  const lines = [];
  lines.push(`# Dosya fuzz koşusu — ${measuredAt ? measuredAt.slice(0, 10) : 'tarih yok'} (commit ${git})`, '');
  lines.push(`Korpus: ${items.length} dosya (\`scripts/fuzz/make-corpus.mjs\`) × ${surfaces.length} yüzey (on kart + editör) = ${cells.length} hücre. Derleme: test kancalı sunucu derlemesi (\`next start\`, 127.0.0.1:${PORT}); masaüstü Chromium (Playwright).`, '');
  lines.push('| Sonuç | Hücre |', '| --- | --- |');
  for (const key of ['iyi', 'belirsiz', 'bozuk', 'ölçülemedi']) lines.push(`| ${key} | ${counts[key] ?? 0} |`);
  lines.push(`| Sayfanın yanıt vermediği en uzun süre | ${tr(longest / 1000)} sn |`);
  lines.push(`| Sayfa hatası görülen hücre | ${withPageErrors} |`);
  lines.push(`| Yakalanmamış söz (unhandled rejection) görülen hücre | ${withRejections} |`);
  lines.push(`| Konsol hatası görülen hücre | ${withConsoleErrors} |`);
  lines.push(`| Bekçinin sayfayı yeniden yüklediği hücre | ${withWatchdog} |`, '');
  lines.push(`Sonuç türleri: ${Object.entries(outcomes).map(([key, value]) => `${key} ${value}`).join(', ')}.`, '');

  const mark = (cell) => {
    if (!cell) return '—';
    const short = { iyi: 'iyi', belirsiz: 'BELİRSİZ', bozuk: 'BOZUK', 'ölçülemedi': 'ölçülemedi' }[cell.verdict] ?? cell.verdict;
    const outcome = { refused: 'ret', saved: 'kaydedildi', ready: 'hazır', failed: 'hata', blocked: 'engellendi', noop: 'iş yok', unclear: 'belirsiz', silent: 'sessiz', stuck: 'takıldı', crash: 'çöktü', frozen: 'dondu' }[cell.outcome] ?? cell.outcome ?? '?';
    return `${short} (${outcome})`;
  };
  lines.push('## Hücre tablosu (satır: dosya, sütun: yüzey; hücre: yargı ve sonuç)', '');
  lines.push(`| Dosya | Beklenen | ${surfaces.map((surface) => SURFACE_LABEL[surface]).join(' | ')} |`);
  lines.push(`| --- | --- | ${surfaces.map(() => '---').join(' | ')} |`);
  for (const item of items) lines.push(`| ${cellText(item.label)} | ${item.expect} | ${surfaces.map((surface) => mark(at(surface, item.id))).join(' | ')} |`);
  lines.push('');

  const findings = cells.filter((cell) => cell.verdict === 'bozuk' || cell.verdict === 'belirsiz' || cell.verdict === 'ölçülemedi');
  lines.push(`## Bulgular (${findings.length} hücre; önce bozuk)`, '');
  const order = { bozuk: 0, belirsiz: 1, 'ölçülemedi': 2 };
  findings.sort((a, b) => (order[a.verdict] ?? 3) - (order[b.verdict] ?? 3) || a.id.localeCompare(b.id) || a.surface.localeCompare(b.surface));
  lines.push('| Yargı | Dosya | Yüzey | Sonuç | Neden | Ekrandaki metin |', '| --- | --- | --- | --- | --- | --- |');
  for (const cell of findings) {
    lines.push(`| ${cell.verdict} | ${cell.id} | ${SURFACE_LABEL[cell.surface] ?? cell.surface} | ${cell.outcome ?? '—'} | ${cellText(cell.why)} | ${cellText((cell.messages ?? []).join(' ')).slice(0, 300)} |`);
  }
  lines.push('');

  lines.push('## Ekranda görülen metinler (aynı metin bir kez; hangi dosya ve yüzeylerde)', '');
  const byText = new Map();
  for (const cell of cells) {
    const text = cellText((cell.messages ?? []).join(' '));
    if (text === '') continue;
    const entry = byText.get(text) ?? { verdicts: new Set(), where: [] };
    entry.verdicts.add(cell.verdict);
    entry.where.push(`${cell.id} × ${SURFACE_LABEL[cell.surface] ?? cell.surface}`);
    byText.set(text, entry);
  }
  lines.push('| Metin | Yargı | Nerede |', '| --- | --- | --- |');
  for (const [text, entry] of [...byText.entries()].sort((a, b) => b[1].where.length - a[1].where.length)) {
    const where = entry.where.length > 6 ? `${entry.where.slice(0, 6).join(', ')} … (${entry.where.length})` : entry.where.join(', ');
    lines.push(`| ${text.slice(0, 400)} | ${[...entry.verdicts].join(', ')} | ${where} |`);
  }
  lines.push('');

  const savedCells = cells.filter((cell) => cell.saved);
  lines.push(`## Kaydedilen dosyalar (${savedCells.length}; ffprobe / ffmpeg denetimi)`, '');
  lines.push('| Dosya | Yüzey | Çıkan | Süre | İzler | Boyut | Denetim |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const cell of savedCells.sort((a, b) => a.id.localeCompare(b.id) || a.surface.localeCompare(b.surface))) {
    const saved = cell.saved;
    const failed = saved.checks.filter((check) => !check.ok);
    lines.push(`| ${cell.id} | ${SURFACE_LABEL[cell.surface] ?? cell.surface} | ${cellText(saved.name)} | ${saved.durationS === null ? '—' : tr(saved.durationS, 2)} sn | ${saved.streams.join(' + ')} | ${saved.width ?? '—'} × ${saved.height ?? '—'} | ${failed.length === 0 ? `hepsi geçti (${saved.checks.length})` : failed.map((check) => `${check.name}: ${cellText(check.value)}`).join('; ')} |`);
  }
  lines.push('');

  const consoleLines = new Map();
  for (const cell of cells) for (const line of cell.consoleErrors ?? []) consoleLines.set(line, (consoleLines.get(line) ?? 0) + 1);
  const rejectionLines = new Map();
  for (const cell of cells) for (const line of cell.unhandledRejections ?? []) rejectionLines.set(line, (rejectionLines.get(line) ?? 0) + 1);
  lines.push('## Konsola düşen hatalar ve yakalanmamış sözler (aynı satır bir kez)', '');
  if (consoleLines.size === 0 && rejectionLines.size === 0) lines.push('Yok.', '');
  for (const [line, count] of [...consoleLines.entries()].sort((a, b) => b[1] - a[1])) lines.push(`- ${count} hücrede (konsol): \`${cellText(line).slice(0, 200)}\``);
  for (const [line, count] of [...rejectionLines.entries()].sort((a, b) => b[1] - a[1])) lines.push(`- ${count} hücrede (yakalanmamış söz): \`${cellText(line).slice(0, 200)}\``);
  lines.push('');

  const slow = cells.filter((cell) => (cell.totalMs ?? 0) > 60_000).sort((a, b) => b.totalMs - a.totalMs).slice(0, 15);
  lines.push('## Süre', '');
  lines.push(`Toplam ${tr(cells.reduce((sum, cell) => sum + (cell.totalMs ?? 0), 0) / 60000)} dakika hücre süresi (sunucu ve derleme hariç). Bir dakikadan uzun süren hücreler: ${slow.length === 0 ? 'yok' : slow.map((cell) => `${cell.id} × ${SURFACE_LABEL[cell.surface] ?? cell.surface} ${tr(cell.totalMs / 1000, 0)} sn (${cell.outcome})`).join(', ')}.`, '');

  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(scratch, 'report.md'), `${lines.join('\n')}\n`);
  writeFileSync(join(scratch, 'report.json'), `${JSON.stringify({ measuredAt, commit: git, counts, outcomes, longestUnresponsiveMs: longest, withPageErrors, withConsoleErrors, withRejections, withWatchdog, cells }, null, 2)}\n`);
  console.log(`fuzz: ${cells.length} cells — iyi ${counts.iyi ?? 0}, belirsiz ${counts.belirsiz ?? 0}, bozuk ${counts.bozuk ?? 0}, ölçülemedi ${counts['ölçülemedi'] ?? 0} → ${join(scratch, 'report.md')}`);
  return counts;
}

// ------------------------------------------------------------ main

async function main() {
  if (flags.has('--report-only')) {
    writeReport();
    return;
  }
  const surfaces = option('surfaces') ?? SURFACES;
  for (const surface of surfaces) {
    if (!SURFACES.includes(surface)) {
      console.error(`fuzz: unknown surface "${surface}" (surfaces: ${SURFACES.join(', ')})`);
      process.exit(2);
    }
  }
  const files = option('files');
  if (!flags.has('--no-corpus')) {
    if (run(process.execPath, [join('scripts', 'fuzz', 'make-corpus.mjs'), `--out=${corpusDir}`]) !== 0) process.exit(1);
  }
  if (!flags.has('--no-build')) build();
  if (!flags.has('--keep-results')) clearResults(surfaces, files);

  const batches = BATCHES.map((batch) => batch.filter((surface) => surfaces.includes(surface))).filter((batch) => batch.length > 0);
  let failed = false;
  for (const [index, batch] of batches.entries()) {
    console.log(`fuzz: batch ${index + 1}/${batches.length} — ${batch.join(', ')}`);
    await acquire(`fuzz run (${batch.join(', ')}) — scripts/fuzz/run-fuzz.mjs`);
    lockHeld = true;
    let server = null;
    try {
      server = await startServer();
      if (playwright(batch, files) !== 0) failed = true;
    } finally {
      await stopServer(server);
      giveBack();
    }
  }
  const counts = writeReport();
  // The run itself is the finding; a broken cell is reported, not thrown. A measurement that could not be taken is.
  process.exit(failed || (counts['ölçülemedi'] ?? 0) > 0 ? 1 : 0);
}

/** The lock is given back only when this run holds it: never someone else's. */
let lockHeld = false;
function giveBack() {
  if (!lockHeld) return;
  lockHeld = false;
  release();
}

let exiting = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (exiting) return;
    exiting = true;
    freePort();
    giveBack();
    process.exit(130);
  });
}

main().catch((error) => {
  console.error(error);
  freePort();
  giveBack();
  process.exit(1);
});
