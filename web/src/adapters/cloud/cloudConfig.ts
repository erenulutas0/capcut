/**
 * Whether this build has the cloud transcript route at all (ADR-039).
 *
 * next.config.ts writes two values from the one build-time setting
 * `NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL` (checked by scripts/lib/cloudOrigin.mjs):
 * the origin below, and `NEXT_PUBLIC_CLOUD_TRANSCRIPT` ('1' or ''). Both are
 * '' in every build that does not name the proxy — the published site and CI
 * among them.
 *
 * The on/off flag is not exported from here on purpose: the two places that
 * decide whether the route's code is loaded (`YaziWizard`, `CloudInviteSlot`)
 * compare `process.env.NEXT_PUBLIC_CLOUD_TRANSCRIPT === '1'` themselves, so
 * the bundler folds it there and leaves the route's chunks out of a build
 * without it (scripts/apply-csp.mjs looks at the export and stops if they
 * are there). This module is only ever loaded from inside those chunks.
 */

/** The proxy's origin ("https://name.workers.dev"); '' when the route is off. */
export const CLOUD_ORIGIN: string = process.env.NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL ?? '';
