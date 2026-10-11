/**
 * The one build-time setting of the cloud transcript route (ADR-039):
 * `NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`, the origin of OUR proxy Worker.
 *
 * Empty (the default, and what the published site and CI build with): the
 * route does not exist in that build — no choice screen, no code path that
 * talks to another origin, and `connect-src` stays `'self'`.
 *
 * Set: exactly one origin, which next.config.ts hands to the page and
 * scripts/apply-csp.mjs adds to `connect-src`. Both read it through this
 * function, so the page can never be told one origin and the policy another.
 *
 * Refused (the build stops): anything that is not a bare origin — a path, a
 * query, credentials, a wildcard — and plain http, except a loopback address
 * in the test-hooks build (the local fake Worker of the tests). The static
 * export refuses test hooks, so a published site can only name an https origin.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

/**
 * @param {string | undefined} raw
 * @param {{ allowLoopbackHttp?: boolean }} [options]
 * @returns {string} '' when the route is off, otherwise the origin ("https://host[:port]")
 */
export function normalizeCloudOrigin(raw, { allowLoopbackHttp = false } = {}) {
  const text = (raw ?? '').trim();
  if (text === '') return '';
  const fail = (why) => {
    throw new Error(`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL must be one origin like https://name.workers.dev — ${why} (got "${text}")`);
  };
  if (/[*\s'";,]/.test(text)) fail('no wildcards, spaces, quotes or lists');
  let url;
  try {
    url = new URL(text);
  } catch {
    return fail('it is not a URL');
  }
  if (url.username || url.password) fail('no credentials');
  if (url.pathname !== '/' || url.search || url.hash) fail('no path, query or fragment');
  if (url.protocol === 'http:') {
    if (!allowLoopbackHttp || !LOOPBACK.has(url.hostname)) fail('it must be https (http only for 127.0.0.1 in the test-hooks build)');
  } else if (url.protocol !== 'https:') {
    fail('it must be https');
  }
  // What the browser compares requests against, and what CSP `connect-src` takes.
  if (text.replace(/\/$/, '') !== url.origin) fail('write it exactly as the origin, lower case, without a default port');
  return url.origin;
}

/** The setting as this build's environment has it. */
export function cloudOriginFromEnv(env = process.env) {
  return normalizeCloudOrigin(env.NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL, { allowLoopbackHttp: env.CLIP_TEST_HOOKS === '1' });
}
