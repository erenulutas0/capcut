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
 *
 * The same pass writes the page watchdog (ADR-044, scripts/lib/page-watchdog.js)
 * into every page, as the first script of <head> — before the policy is
 * computed, so its hash is in the policy like every other inline script's.
 * `next dev` has no watchdog either.
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { cloudOriginFromEnv } from './lib/cloudOrigin.mjs';
import { applyCsp } from './lib/csp.mjs';
import { hasTwin, insertLanguageScript, languageScript } from './lib/languageScript.mjs';
import { insertWatchdog, watchdogScript } from './lib/pageWatchdogScript.mjs';

const root = process.cwd();
const staticExport = process.env.STATIC_EXPORT === '1';
const dir = join(root, staticExport ? 'out' : join('.next', 'server', 'app'));
// '' unless this build was given the transcript proxy's origin (ADR-039): then, and only then, one more
// origin in connect-src. A malformed value stops the build here (and in next.config.ts before it).
const connectOrigin = cloudOriginFromEnv();
// The site's sub-path ('' locally and in e2e, '/capcut' on GitHub Pages): the watchdog must know which
// files are the app's own and which service worker is its own.
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const watchdog = watchdogScript(base);
// The page in the reader's language (ADR-048, scripts/lib/language-redirect.js): first in <head> of every
// app page, before the watchdog — a page about to be replaced by its twin should start nothing.
const language = languageScript(base, staticExport);

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

let twins = 0;
for (const file of pages) {
  let page = insertWatchdog(readFileSync(file, 'utf8'), watchdog);
  if (hasTwin(relative(dir, file).split('\\').join('/'))) {
    page = insertLanguageScript(page, language);
    twins += 1;
  }
  const { html, policy } = applyCsp(page, { connectOrigin });
  writeFileSync(file, html);
  const hashes = (policy.match(/'sha256-/g) ?? []).length;
  console.log(`apply-csp: ${relative(root, file)} (${hashes} hashes)`);
}
console.log(`apply-csp: page watchdog in every page (${watchdog.length} characters, base "${base}")`);
console.log(`apply-csp: language script in ${twins} pages (${language.length} characters)`);
console.log(connectOrigin ? `apply-csp: connect-src 'self' ${connectOrigin} (cloud transcript route ON in this build)` : "apply-csp: connect-src 'self' (no other origin)");

if (staticExport) {
  // `.wasm` under _next/static/media: the bundler's copy of onnxruntime-web's
  // WebAssembly file. The transcript engine never loads it from there — it
  // runs the sha256-checked copy in the model store (ADR-036), which
  // scripts/fetch-models.mjs publishes under /models/ — so the site does not
  // carry the same 27 MB twice. `.mjs` there is onnxruntime-web's bundle for
  // its proxy-worker mode, which the engine does not use.
  const unpublished = files.filter(
    (f) => f.endsWith('.map') || (/[\\/]_next[\\/]static[\\/]media[\\/]/.test(f) && /\.(tsx?|wasm|mjs)$/.test(f)),
  );
  for (const file of unpublished) {
    rmSync(file);
    console.log(`apply-csp: removed ${relative(root, file)} (not published)`);
  }

  // The stand-in speech recogniser of the UI tests must never be published
  // (ADR-036). next.config.ts already refuses CLIP_TEST_HOOKS with a static
  // export; this looks at what was actually built.
  const STUB_MARKER = 'clip-transcript-stub-engine';
  const scripts = walk(dir).filter((f) => f.endsWith('.js'));
  const tainted = scripts.filter((f) => readFileSync(f, 'utf8').includes(STUB_MARKER));
  if (tainted.length > 0) {
    console.error(`apply-csp: the test stand-in engine is in the export (${tainted.map((f) => relative(root, f)).join(', ')})`);
    process.exit(1);
  }

  // The cloud transcript route (ADR-039) is OFF unless the build names the proxy. An export built without
  // it must not carry the code that talks to the proxy at all: not "unreachable", absent.
  if (!connectOrigin) {
    const CLOUD_MARKERS = ['/v1/jobs', '/v1/quota', 'AssemblyAI'];
    const carrying = scripts.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return CLOUD_MARKERS.some((marker) => text.includes(marker));
    });
    if (carrying.length > 0) {
      console.error(`apply-csp: the cloud transcript client is in an export built without NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL (${carrying.map((f) => relative(root, f)).join(', ')})`);
      process.exit(1);
    }
  }
}
