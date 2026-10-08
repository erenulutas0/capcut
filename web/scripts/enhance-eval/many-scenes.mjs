/**
 * The changing-exposure test over many different scenes (ADR-037, 8 Oct 2026).
 *
 *   node scripts/enhance-eval/many-scenes.mjs [--scenes=10] [--keep]
 *   ENHANCE_SOURCE=old-enhance.ts node scripts/enhance-eval/many-scenes.mjs   (another version of the planner)
 *
 * Generates the e2e fixture `changing` (tests/e2e/enhance-media.ts) with
 * `scenes` different seeds of its noise pattern — the same exposure
 * schedule over a different picture each time — and, for each, plans and
 * renders it as flicker.mjs does (320 px wide, reference renderer). Reports
 * what the e2e test asserts: how far the mean luma of the well-exposed
 * stretch (frames 135..165) moves, and how much the dark stretches are
 * lifted. A planner on a knife edge shows as a spread in the first column.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { decodeFrames, loadEnhance, meanLuma, parseArgs, resultsDir, round, webRoot } from './lib.mjs';

const args = parseArgs();
const scenes = Number(args.scenes ?? 10);
const enhance = await loadEnhance();
const work = join(webRoot, 'tests', 'media', 'enhance', 'scenes');
mkdirSync(work, { recursive: true });
// The recipe's transpiled copies live outside the project: a linter running meanwhile must not find them.
const recipes = mkdtempSync(join(tmpdir(), 'clip-enhance-scenes-'));

const ts = (await import('typescript')).default;
const source = readFileSync(join(webRoot, 'tests', 'e2e', 'enhance-media.ts'), 'utf8');
if (!source.includes('random_seed=7')) throw new Error('the recipe changed: its seed is no longer random_seed=7');

const width = 320;
const height = 180;
const fps = 30;
const rows = [];
for (let scene = 1; scene <= scenes; scene += 1) {
  const file = join(work, `degisen-isik-${scene}.mp4`);
  if (!existsSync(file)) {
    const { outputText } = ts.transpileModule(source.replaceAll('random_seed=7', `random_seed=${100 + scene}`), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    const modulePath = join(recipes, `recipe-${scene}.mjs`);
    writeFileSync(modulePath, outputText);
    (await import(pathToFileURL(modulePath).href)).makeEnhanceFixture('changing', file);
    rmSync(modulePath, { force: true });
  }
  const frames = decodeFrames(file, { at: 0, frames: 300, width, height, fps });
  const points = enhance
    .analysisFrames([{ startFrame: 0, endFrame: frames.length }], fps)
    .map((frame) => ({ frame, stats: enhance.measureFrame(frames[frame], width, height) }));
  for (let looked = 0; looked < enhance.REFINE_BUDGET; looked += 1) {
    points.sort((a, b) => a.frame - b.frame);
    const frame = enhance.frameToRefine(points);
    if (frame === null) break;
    points.push({ frame, stats: enhance.measureFrame(frames[frame], width, height) });
  }
  const row = { scene };
  for (const strength of ['light', 'auto', 'strong']) {
    const plan = enhance.planEnhancement(points, strength, fps);
    const out = new Uint8ClampedArray(width * height * 4);
    let scratch = null;
    const change = (from, to) => {
      let sum = 0;
      for (let frame = from; frame < to; frame += 1) {
        const rendered = enhance.renderEnhanced(frames[frame], width, height, enhance.paramsAtFrame(plan, frame), undefined, out, scratch);
        scratch = rendered.scratch;
        sum += meanLuma(out, width, height) - meanLuma(frames[frame], width, height);
      }
      return sum / (to - from);
    };
    row[strength] = { wellExposed: change(135, 165), firstSecond: change(0, 30), darkStep: change(195, 225) };
  }
  rows.push(row);
  console.log(
    `scene ${String(scene).padStart(2)} | well-exposed stretch moves by: light ${round(row.light.wellExposed, 2)}, auto ${round(row.auto.wellExposed, 2)}, strong ${round(row.strong.wellExposed, 2)}` +
      ` | auto lifts the first second by ${round(row.auto.firstSecond, 1)}, the dark step by ${round(row.auto.darkStep, 1)}`,
  );
  if (!args.keep) rmSync(file, { force: true });
}
for (const strength of ['light', 'auto', 'strong']) {
  const values = rows.map((row) => Math.abs(row[strength].wellExposed));
  console.log(`${strength}: well-exposed stretch, |change| over ${rows.length} scenes: least ${round(Math.min(...values), 2)}, most ${round(Math.max(...values), 2)} levels`);
}
rmSync(recipes, { recursive: true, force: true });
mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, `many-scenes-${args.tag ?? 'default'}.json`), `${JSON.stringify(rows, null, 1)}\n`);
