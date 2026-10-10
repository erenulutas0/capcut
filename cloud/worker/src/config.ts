/**
 * Configuration of the proxy, read from Worker variables (wrangler.jsonc
 * `vars`, or the Cloudflare dashboard) and secrets (`wrangler secret put`).
 *
 * The defaults are the SAFE ones: with nothing set the cloud route is OFF
 * (`ENABLED` is not "true" and `MONTHLY_CAP_USD` is 0), so a deploy by itself
 * cannot spend anything.
 */
export interface Env {
  LEDGER: DurableObjectNamespace<import('./ledger').Ledger>;
  // secrets
  ASSEMBLYAI_API_KEY?: string;
  ADMIN_TOKEN?: string;
  // variables
  ENABLED?: string;
  MONTHLY_CAP_USD?: string;
  PRICE_USD_PER_HOUR?: string;
  ALLOWED_ORIGINS?: string;
  MAX_JOB_MINUTES?: string;
  MAX_BYTES_PER_SECOND?: string;
  INVITE_MINUTES_DEFAULT?: string;
  RATE_LIMIT_PER_HOUR?: string;
  PROVIDER_REGION?: string;
  SPEECH_MODELS?: string;
  SPEAKER_LABELS?: string;
  RESULT_TTL_MINUTES?: string;
  /** Tests only: must be exactly http://provider.mock (see providerBase). */
  PROVIDER_BASE_URL_OVERRIDE?: string;
}

export interface Config {
  enabled: boolean;
  /** Monthly hard cap in micro-USD. 0 = cloud route off. */
  capMicro: number;
  /** Price per hour of audio in micro-USD. */
  priceMicroPerHour: number;
  allowedOrigins: string[];
  maxJobSeconds: number;
  maxBytesPerSecond: number;
  maxUploadBytes: number;
  inviteSecondsDefault: number;
  rateLimitPerHour: number;
  providerBase: string;
  speechModels: string[];
  speakerLabels: boolean;
  resultTtlSeconds: number;
}

/** Cloudflare refuses request bodies above 100 MB on the Free and Pro plans; stay under it. */
export const HARD_MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
/** Slack on top of duration × bytes-per-second: container headers of a short file. */
export const UPLOAD_SLACK_BYTES = 64 * 1024;

const PROVIDER_BASES: Record<string, string> = {
  us: 'https://api.assemblyai.com',
  eu: 'https://api.eu.assemblyai.com',
};
const TEST_BASE = 'http://provider.mock';

const number = (value: string | undefined, fallback: number, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  // A value that is not a number must never open the route wider: fall back to the safe default.
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
};

export function readConfig(env: Env): Config {
  const maxJobSeconds = Math.round(number(env.MAX_JOB_MINUTES, 120, { min: 1, max: 600 }) * 60);
  const maxBytesPerSecond = Math.round(number(env.MAX_BYTES_PER_SECOND, 8000, { min: 500, max: 64000 }));
  const region = (env.PROVIDER_REGION ?? 'eu').toLowerCase();
  return {
    enabled: env.ENABLED === 'true',
    capMicro: Math.round(number(env.MONTHLY_CAP_USD, 0, { min: 0, max: 10000 }) * 1e6),
    // Default: Universal-3.5 Pro $0.21/h + speaker labels $0.02/h (assemblyai.com/pricing, read 2026-10-10).
    priceMicroPerHour: Math.round(number(env.PRICE_USD_PER_HOUR, 0.23, { min: 0.01, max: 100 }) * 1e6),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    maxJobSeconds,
    maxBytesPerSecond,
    maxUploadBytes: Math.min(HARD_MAX_UPLOAD_BYTES, maxJobSeconds * maxBytesPerSecond + UPLOAD_SLACK_BYTES),
    inviteSecondsDefault: Math.round(number(env.INVITE_MINUTES_DEFAULT, 60, { min: 1, max: 100000 }) * 60),
    rateLimitPerHour: Math.round(number(env.RATE_LIMIT_PER_HOUR, 10, { min: 1, max: 10000 })),
    providerBase: env.PROVIDER_BASE_URL_OVERRIDE === TEST_BASE ? TEST_BASE : (PROVIDER_BASES[region] ?? PROVIDER_BASES.eu),
    speechModels: (env.SPEECH_MODELS ?? 'universal-3-5-pro').split(',').map((model) => model.trim()).filter(Boolean),
    speakerLabels: (env.SPEAKER_LABELS ?? 'true') === 'true',
    resultTtlSeconds: Math.round(number(env.RESULT_TTL_MINUTES, 60, { min: 1, max: 1440 }) * 60),
  };
}

/** Cost of `seconds` of audio in micro-USD, rounded up (never under-counts). */
export function costMicro(seconds: number, priceMicroPerHour: number): number {
  return Math.ceil((Math.ceil(seconds) * priceMicroPerHour) / 3600);
}

export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
