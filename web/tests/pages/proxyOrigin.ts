/**
 * The origin of OUR transcript proxy Worker (ADR-039) as deployed by the founder on 14 Oct 2026 —
 * the value the repository variable CLOUD_TRANSCRIPT_URL gets when the internet route of
 * "Yazıya dök" is switched on for the published site.
 *
 * Tests only, and only as an address to EXPECT or to BLOCK: no test sends a request to it. The
 * pre-flight test (cloud-preflight.spec.ts) routes every request to this origin to an abort or a
 * local stub, and the live run (playwright.live.config.ts) accepts it as the one extra origin the
 * published policy may name.
 */
export const PUBLISHED_PROXY_ORIGIN = 'https://lilocut-transcript-proxy.eerenulutass.workers.dev';
