/**
 * Are the "İyileştir" e2e fixtures the same bytes on every run? (ADR-037, 8 Oct 2026)
 *
 *   node scripts/enhance-eval/fixture-determinism.mjs [--runs=3] [--only=changing,noisy]
 *
 * Generates every fixture of tests/e2e/enhance-media.ts `runs` times into a
 * temporary folder with the recipe the tests use (`makeEnhanceFixture`) and
 * compares the sha256 of the files. Exits 1 if any two runs differ.
 *
 * Why it exists: until 8 Oct 2026 the recipe's `perlin` source drew a new
 * pattern on every run (its seed is only used with `random_mode=seed`) — two
 * worktrees had two different `degisen-isik.mp4`, and one of them failed a test.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseArgs, webRoot } from './lib.mjs';

const args = parseArgs();
const runs = Number(args.runs ?? 3);
const work = mkdtempSync(join(tmpdir(), 'clip-enhance-fixtures-'));

// The recipe itself, transpiled as it is (it imports node built-ins only).
const ts = (await import('typescript')).default;
const source = readFileSync(join(webRoot, 'tests', 'e2e', 'enhance-media.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const modulePath = join(work, 'enhance-media.mjs');
writeFileSync(modulePath, outputText);
const media = await import(pathToFileURL(modulePath).href);

const names = args.only ? String(args.only).split(',') : media.ENHANCE_FIXTURES;
let different = 0;
try {
  for (const name of names) {
    const hashes = [];
    let bytes = 0;
    for (let run = 0; run < runs; run += 1) {
      const file = join(work, `${name}-${run}.mp4`);
      media.makeEnhanceFixture(name, file);
      hashes.push(createHash('sha256').update(readFileSync(file)).digest('hex'));
      bytes = statSync(file).size;
      rmSync(file, { force: true });
    }
    const same = hashes.every((hash) => hash === hashes[0]);
    if (!same) different += 1;
    console.log(`${same ? 'SAME     ' : 'DIFFERENT'} ${name.padEnd(9)} ${runs} runs, ${bytes} bytes, sha256 ${[...new Set(hashes)].map((hash) => hash.slice(0, 16)).join(' / ')}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (different > 0) {
  console.error(`${different} fixture(s) are not deterministic`);
  process.exit(1);
}
