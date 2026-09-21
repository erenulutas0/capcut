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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No remote media, no analytics, no third-party scripts.
  // The editor is a client-only module; nothing here enables uploads.
  ...(staticExport ? { output: 'export' as const, trailingSlash: true } : {}),
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion(),
    NEXT_PUBLIC_GIT_COMMIT: gitCommit(),
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
