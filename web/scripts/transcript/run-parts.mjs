/**
 * Several `run-app.mjs` side by side for one tag (ADR-036): the realistic
 * set is about two hours of sound and the recogniser uses one thread, so
 * accuracy runs are split over a few browsers. SPEED must not be read from
 * such a run (the browsers share the processor); the rows say so
 * (`parallel` in the result file). Speed and memory are measured one clip
 * at a time.
 *
 *   node scripts/transcript/run-parts.mjs --tag=dev-before-base --parts="ami-es2004a,steps-libri;ami-es2004a-far;set:rneg,set:neg" -- --model=base --settings=2026-10-05
 *
 * `--parts`: groups separated by `;`, each a comma list of clip ids or
 * `set:<name>`. Everything after `--` goes to every run-app.mjs.
 * Then: node scripts/transcript/score-real.mjs <tag>
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..', '..');
const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split < 0 ? argv : argv.slice(0, split);
const rest = split < 0 ? [] : argv.slice(split + 1);
const arg = (name, fallback) => {
  const found = own.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const tag = arg('tag', null);
const parts = arg('parts', '').split(';').map((part) => part.trim()).filter(Boolean);
if (!tag || parts.length === 0) {
  console.error('usage: run-parts.mjs --tag=<tag> --parts="a,b;c;set:x" -- <run-app args>');
  process.exit(2);
}

const runs = parts.map((part, index) => {
  const items = part.split(',').map((item) => item.trim()).filter(Boolean);
  const clips = items.filter((item) => !item.startsWith('set:'));
  const sets = items.filter((item) => item.startsWith('set:')).map((item) => item.slice(4));
  const args = [join(here, 'run-app.mjs'), `--tag=${tag}`, `--part=${index + 1}`, ...(clips.length ? [`--clips=${clips.join(',')}`] : []), ...(sets.length ? [`--sets=${sets.join(',')}`] : []), ...(parts.length > 1 ? ['--parallel'] : []), ...rest];
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: webDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const prefix = `[${index + 1}] `;
    const show = (chunk) => process.stdout.write(chunk.toString().split(/\r?\n/).filter(Boolean).map((line) => `${prefix}${line}\n`).join(''));
    child.stdout.on('data', show);
    child.stderr.on('data', show);
    child.on('exit', (code) => done(code ?? 1));
    child.on('error', () => done(1));
  });
});
const codes = await Promise.all(runs);
console.log(`run-parts: ${tag} exit codes ${codes.join(', ')}`);
process.exit(codes.some((code) => code !== 0) ? 1 : 0);
