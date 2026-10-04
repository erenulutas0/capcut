import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Build identity for the diagnostics file ("Sorun bildir"). Read once at
 * build time and inlined as public constants: the page never has to ask a
 * server which build it is. `GIT_COMMIT` wins when a CI sets it; without git
 * (a source tarball) the file honestly says "unknown".
 */
function appVersion(): string {
  try {
    // `next build` / `next start` run from web/, where package.json lives.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function gitCommit(): string {
  const fromEnv = process.env.GIT_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/**
 * GitHub Pages (docs/beta/DEPLOY_GUIDE.md): a fully static export served from
 * a sub-path (`/capcut`). Both are opt-in through the environment so local
 * development, `next start` and the e2e suite keep running at the root.
 * `trailingSlash` makes every page a folder with index.html, which any static
 * host serves without rewrite rules.
 */
const staticExport = process.env.STATIC_EXPORT === '1';
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const testHooks = process.env.CLIP_TEST_HOOKS === '1';
if (testHooks && staticExport) {
  throw new Error('CLIP_TEST_HOOKS=1 is for the e2e build only; the static export (the published site) must not contain test hooks.');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Doc 11 "private source map": no browser source maps are built or
  // published (the default, stated so it is not turned on by accident).
  // scripts/apply-csp.mjs also removes any stray *.map from the export.
  productionBrowserSourceMaps: false,
  // `next start` (e2e, local checks) does not announce itself; GitHub Pages
  // serves files and sends no such header anyway.
  poweredByHeader: false,
  // No remote media, no analytics, no third-party scripts.
  // The editor is a client-only module; nothing here enables uploads.
  ...(staticExport ? { output: 'export' as const, trailingSlash: true } : {}),
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion(),
    NEXT_PUBLIC_GIT_COMMIT: gitCommit(),
    NEXT_PUBLIC_BASE_PATH: basePath,
    // '1' only for the e2e build (ADR-036): lets a test supply a tiny model
    // list and a scripted stand-in for the speech recogniser. Always defined,
    // so the code behind it is removed from every other build; a static
    // export (the published site) refuses the flag outright below.
    NEXT_PUBLIC_CLIP_TEST_HOOKS: testHooks ? '1' : '',
  },
};

export default nextConfig;
