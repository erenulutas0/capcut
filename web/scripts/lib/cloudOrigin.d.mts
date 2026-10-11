/** Types for cloudOrigin.mjs (used by next.config.ts and the unit tests). */
export function normalizeCloudOrigin(raw: string | undefined, options?: { allowLoopbackHttp?: boolean }): string;
export function cloudOriginFromEnv(env?: Record<string, string | undefined>): string;
