'use client';

/**
 * Browser side of "Sorun bildir": what this session has seen, plus a snapshot
 * of what the browser already exposes to every page. Everything stays in
 * memory (errors, last gate) or in this browser (export log) until the user
 * downloads the file; nothing is sent automatically.
 */

import type { CapabilityReportV1 } from './exportCapability';
import { exportLog } from './exportLogStore';
import type { Project } from '@/domain/edl';
import {
  ERROR_CODE_PATTERN,
  buildDiagnostics,
  type CapabilitySummary,
  type DiagnosticsReport,
  type ErrorArea,
  type SessionError,
} from '@/domain/diagnostics';

/** Build-time values (next.config.ts). Absent in dev and unit tests. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';
export const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT ?? 'unknown';
/**
 * Where users should send the file. Deliberately empty until the founder
 * decides (doc 30 K02); the UI then says so instead of inventing an address.
 */
export const SUPPORT_CONTACT = (process.env.NEXT_PUBLIC_SUPPORT_CONTACT ?? '').trim();

/** A session is short; the last few dozen codes are what support reads. */
const SESSION_ERROR_LIMIT = 30;

const sessionErrors: SessionError[] = [];
let lastCapability: CapabilitySummary | null = null;

/**
 * Remembers an error CODE for this tab only. Anything that is not a
 * snake_case code (a message, a path) is dropped here rather than trusted to
 * be cleaned later. A code repeated back to back is kept once: a re-render
 * showing the same error is not a new event.
 */
export function recordError(area: ErrorArea, code: string, now: Date = new Date()): void {
  if (!ERROR_CODE_PATTERN.test(code)) return;
  const last = sessionErrors[sessionErrors.length - 1];
  if (last && last.area === area && last.code === code) return;
  sessionErrors.push({ at: now.toISOString(), area, code });
  if (sessionErrors.length > SESSION_ERROR_LIMIT) sessionErrors.splice(0, sessionErrors.length - SESSION_ERROR_LIMIT);
}

export function recordCapability(report: CapabilityReportV1, now: Date = new Date()): void {
  const { encoder, source } = report;
  lastCapability = {
    at: now.toISOString(),
    environmentPassed: Object.values(report.environment).every(Boolean),
    videoConfigSupported: encoder ? encoder.videoConfigSupported : null,
    audioConfigSupported: encoder ? encoder.audioConfigSupported : null,
    selfTestPassed: encoder ? encoder.selfTestPassed : null,
    captionFont: encoder ? encoder.captionFont : null,
    sourceVideoDecodable: source ? source.videoDecodable : null,
    sourceAudioDecodable: source ? source.audioDecodable : null,
    sourceVideoCodec: source ? source.sourceVideoCodec : null,
    sourceAudioCodec: source ? source.sourceAudioCodec : null,
    sourceIsHdr: source ? source.isHdr : null,
    blockers: [...report.blockers],
  };
  for (const code of report.blockers) recordError('capability', code, now);
}

let listening = false;

/**
 * Uncaught errors are recorded by their constructor name only ("TypeError"
 * becomes `type_error`). The message is never kept: it can quote a file name
 * or a caption line.
 */
export function listenForUncaughtErrors(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const toCode = (value: unknown): string => {
    const name = value instanceof Error ? value.name : 'unknown';
    const snake = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    return ERROR_CODE_PATTERN.test(snake) ? snake : 'unknown';
  };
  window.addEventListener('error', (event) => recordError('uncaught', toCode(event.error)));
  window.addEventListener('unhandledrejection', (event) => recordError('uncaught', toCode(event.reason)));
}

/** A copy of what this tab has recorded; callers cannot change the originals. */
export function sessionSnapshot(): { errors: SessionError[]; capability: CapabilitySummary | null } {
  return { errors: [...sessionErrors], capability: lastCapability };
}

async function storageEstimate(): Promise<{ quotaBytes: number; usageBytes: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { quotaBytes: estimate.quota ?? 0, usageBytes: estimate.usage ?? 0 };
  } catch {
    return null;
  }
}

/** Reads what any page can read; see `buildDiagnostics` for what is kept. */
export async function collectDiagnostics(project: Project | null): Promise<DiagnosticsReport> {
  const global = window as unknown as Record<string, unknown>;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
    deviceMemory?: number;
    gpu?: unknown;
  };
  const [storage, log] = await Promise.all([storageEstimate(), exportLog().read()]);
  const session = sessionSnapshot();

  return buildDiagnostics({
    now: new Date(),
    app: { version: APP_VERSION, commit: GIT_COMMIT },
    browser: {
      userAgent: nav.userAgent,
      platform: nav.userAgentData?.platform ?? nav.platform ?? '',
      language: nav.language,
      hardwareConcurrency: nav.hardwareConcurrency ?? null,
      deviceMemoryGb: nav.deviceMemory ?? null,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    },
    features: {
      secureContext: window.isSecureContext === true,
      crossOriginIsolated: window.crossOriginIsolated === true,
      worker: typeof global.Worker === 'function',
      offscreenCanvas: typeof global.OffscreenCanvas === 'function',
      videoEncoder: typeof global.VideoEncoder === 'function',
      audioEncoder: typeof global.AudioEncoder === 'function',
      videoDecoder: typeof global.VideoDecoder === 'function',
      audioDecoder: typeof global.AudioDecoder === 'function',
      opfs: typeof nav.storage?.getDirectory === 'function',
      webGpu: nav.gpu !== undefined,
      indexedDb: typeof global.indexedDB === 'object' && global.indexedDB !== null,
    },
    storage,
    capability: session.capability,
    project,
    exportLog: log,
    sessionErrors: session.errors,
  });
}
