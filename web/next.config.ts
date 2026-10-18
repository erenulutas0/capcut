import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

import { cloudOriginFromEnv } from './scripts/lib/cloudOrigin.mjs';
import { controllerNameFromEnv } from './scripts/lib/dataController.mjs';

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

/**
 * The cloud transcript route (ADR-039) exists only in a build that names our
 * proxy Worker: `NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL=https://…`. Empty — the
 * default, the published site, CI — and the route is not in the build: no
 * choice screen, no request to another origin, `connect-src 'self'`.
 * A value that is not one https origin stops the build (cloudOrigin.mjs).
 */
const cloudOrigin = cloudOriginFromEnv();

/**
 * The data controller's name for /gizlilik (doc 30 K02), read by the page itself. Checked here so an
 * e-mail address or a link in it stops the build instead of being published (dataController.mjs).
 */
controllerNameFromEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Doc 11 "private source map": no browser source maps are built or
  // published (the default, stated so it is not turned on by accident).
  // scripts/apply-csp.mjs also removes any stray *.map from the export.
  productionBrowserSourceMaps: false,
  // `next start` (e2e, local checks) does not announce itself; GitHub Pages
  // serves files and sends no such header anyway.
  poweredByHeader: false,
  // Two root layouts (ADR-048: the Turkish pages and the English ones), so an address that is no page
  // is answered by app/global-not-found.tsx, which draws its own document in both languages.
  experimental: { globalNotFound: true },
  // No remote media, no analytics, no third-party scripts.
  // The editor is a client-only module; nothing here enables uploads.
  ...(staticExport ? { output: 'export' as const, trailingSlash: true } : {}),
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion(),
    NEXT_PUBLIC_GIT_COMMIT: gitCommit(),
    NEXT_PUBLIC_BASE_PATH: basePath,
    // '1' where every page is a folder (the static export): an address built by hand for a full page
    // load must end in '/' as `next/link`'s do (components/home/navigationFallback.ts).
    NEXT_PUBLIC_TRAILING_SLASH: staticExport ? '1' : '',
    // '1' only for the e2e build (ADR-036): lets a test supply a tiny model
    // list and a scripted stand-in for the speech recogniser. Always defined,
    // so the code behind it is removed from every other build; a static
    // export (the published site) refuses the flag outright below.
    NEXT_PUBLIC_CLIP_TEST_HOOKS: testHooks ? '1' : '',
    // Always defined: '' and '' when the route is off, so the code behind it is removed from the build
    // (scripts/apply-csp.mjs looks at the export and stops if it is there anyway).
    NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL: cloudOrigin,
    NEXT_PUBLIC_CLOUD_TRANSCRIPT: cloudOrigin ? '1' : '',
  },
};

export default nextConfig;
