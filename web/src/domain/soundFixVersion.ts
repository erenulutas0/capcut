/**
 * The number of the "Sesi düzelt" chain (ADR-049), on its own so the render plan can write it into
 * its fingerprint (ADR-050) without carrying the chain itself (`soundFix.ts`: filters, level,
 * compressor, limiter) into every page's first load. `soundFix.ts` re-exports it: a measured plan is
 * only used by the same chain, and a download made with another chain is another file.
 */
export const SOUND_FIX_VERSION = 1;
