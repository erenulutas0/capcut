export const dynamic = 'force-static';

/**
 * `<base>/sw.js`, the service worker (ADR-031). This route only reserves the
 * address: its body is written after the build by `scripts/build-sw.mjs`,
 * which knows the build's files (`out/sw.js` for the static export,
 * `.next/server/app/sw.js.body` for `next start`). What this placeholder
 * serves (`next dev`, where the worker is never registered) does nothing.
 */
export function GET(): Response {
  return new Response('// Clip service worker: written by scripts/build-sw.mjs after `next build`.\n', {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
}
