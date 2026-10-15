/**
 * The number the render plan writes into its fingerprint for "İyileştir" (ADR-037).
 *
 * The plan is compiled on every page that can download, so it is in each page's first load; the
 * enhancement maths (`enhance.ts`, about 15 KB of script and two lookup tables built when it loads)
 * is not needed there. The number lives here so the plan does not carry the maths with it.
 * `enhance.ts` has no runtime imports (its measurement scripts load it by itself), so it repeats the
 * number as `ENHANCE_ENGINE_VERSION`; tests/unit/enhanceVersion.test.ts keeps the two equal.
 */
export const ENHANCE_PLAN_VERSION = 2;
