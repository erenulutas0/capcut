/**
 * Post-build step of `npm run build` (see scripts/lib/csp.mjs for the policy
 * and why it is written after the build).
 *
 * - Static export (STATIC_EXPORT=1, GitHub Pages): every HTML file in out/.
 *   Also removes what must not be published next to the site (doc 11
 *   "private source map"): *.map files and TypeScript sources that Turbopack
 *   copies as assets for `new Worker(new URL('./x.ts', import.meta.url))` —
 *   the workers themselves run from the compiled chunks.
 * - Server build (`next start`, used by the e2e suite): the prerendered HTML
 *   in .next/server/app/, which `next start` serves as is.
 *
 * `next dev` has no policy: its hot reload needs eval and changing inline
 * scripts. Tests and the published site always run a build.
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { applyCsp } from './lib/csp.mjs';

const root = process.cwd();
const staticExport = process.env.STATIC_EXPORT === '1';
const dir = join(root, staticExport ? 'out' : join('.next', 'server', 'app'));

function walk(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(dir);
const pages = files.filter((f) => f.endsWith('.html'));
if (pages.length === 0) {
  console.error(`apply-csp: no HTML in ${dir}`);
  process.exit(1);
}

for (const file of pages) {
  const { html, policy } = applyCsp(readFileSync(file, 'utf8'));
  writeFileSync(file, html);
  const hashes = (policy.match(/'sha256-/g) ?? []).length;
  console.log(`apply-csp: ${relative(root, file)} (${hashes} hashes)`);
}

if (staticExport) {
  const unpublished = files.filter(
    (f) => f.endsWith('.map') || (/[\\/]_next[\\/]static[\\/]media[\\/]/.test(f) && /\.tsx?$/.test(f)),
  );
  for (const file of unpublished) {
    rmSync(file);
    console.log(`apply-csp: removed ${relative(root, file)} (not published)`);
  }
}
