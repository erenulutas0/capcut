/**
 * The local export log: the last export attempts, kept ONLY in this browser
 * so a beta user can hand them over with a diagnostics file if they choose.
 *
 * What an entry may hold is fixed here, field by field, and every value is a
 * number, an enum or a short code. There is deliberately no free-text field:
 * a file name, a project title or a caption line has nowhere to go, so it
 * cannot end up in the log by accident.
 */

import type { ExportFailureCode, ExportOutputRoute } from './exportEvents';
import type { RenderPlan } from './renderPlan';

/** Enough to see a pattern across a beta session, small enough to read. */
export const EXPORT_LOG_LIMIT = 20;

export type ExportOutcome = 'succeeded' | 'failed' | 'canceled';

export interface ExportLogEntry {
  /** ISO timestamp of the end of the attempt. */
  at: string;
  outcome: ExportOutcome;
  /** Only for `failed`. */
  failureCode: ExportFailureCode | null;
  /** Measured from the file when it succeeded, otherwise the planned length. */
  outputDurationMs: number;
  width: number;
  height: number;
  /** Known only when a file was produced. */
  route: ExportOutputRoute | null;
  /** Page-side wall clock from "start" to the terminal event. */
  elapsedMs: number;
  /**
   * First characters of the render plan fingerprint. Two attempts of the same
   * recipe share it, which is all support needs; the prefix is a hash of
   * numbers and cannot be turned back into the recipe.
   */
  planPrefix: string;
}

const OUTCOMES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'canceled']);
const ROUTES: ReadonlySet<string> = new Set(['opfs', 'memory']);
/** Codes are snake_case enums; anything else (a path, a name) is refused. */
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const PREFIX_PATTERN = /^fp_[0-9a-f]{1,8}$/;

export function planPrefix(fingerprint: string): string {
  const prefix = fingerprint.slice(0, 9);
  return PREFIX_PATTERN.test(prefix) ? prefix : 'fp_';
}

export type AttemptEnd =
  | {
      outcome: 'succeeded';
      measuredDurationUs: number;
      width: number;
      height: number;
      route: ExportOutputRoute;
    }
  | { outcome: 'failed'; code: ExportFailureCode }
  | { outcome: 'canceled' };

/** Builds the entry from the plan and how the attempt ended — nothing else. */
export function exportLogEntry(plan: RenderPlan, end: AttemptEnd, elapsedMs: number, now: Date): ExportLogEntry {
  const succeeded = end.outcome === 'succeeded';
  return {
    at: now.toISOString(),
    outcome: end.outcome,
    failureCode: end.outcome === 'failed' ? end.code : null,
    outputDurationMs: Math.round((succeeded ? end.measuredDurationUs : plan.expectedDurationUs) / 1000),
    width: succeeded ? end.width : plan.width,
    height: succeeded ? end.height : plan.height,
    route: succeeded ? end.route : null,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    planPrefix: planPrefix(plan.fingerprint),
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads an entry back from storage. Stored data is input: a row from another
 * build or a hand-edited database is re-checked field by field, and only the
 * known fields are copied, so an extra property can never reach a
 * diagnostics file through the log.
 */
export function sanitizeExportLogEntry(raw: unknown): ExportLogEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  const at = typeof row.at === 'string' && !Number.isNaN(Date.parse(row.at)) ? new Date(row.at).toISOString() : null;
  const outcome = typeof row.outcome === 'string' && OUTCOMES.has(row.outcome) ? (row.outcome as ExportOutcome) : null;
  const outputDurationMs = finiteNumber(row.outputDurationMs);
  const width = finiteNumber(row.width);
  const height = finiteNumber(row.height);
  const elapsedMs = finiteNumber(row.elapsedMs);
  if (at === null || outcome === null || outputDurationMs === null || width === null || height === null || elapsedMs === null) {
    return null;
  }

  const failureCode =
    outcome === 'failed' && typeof row.failureCode === 'string' && CODE_PATTERN.test(row.failureCode)
      ? (row.failureCode as ExportFailureCode)
      : null;
  const route = typeof row.route === 'string' && ROUTES.has(row.route) ? (row.route as ExportOutputRoute) : null;
  const prefix = typeof row.planPrefix === 'string' && PREFIX_PATTERN.test(row.planPrefix) ? row.planPrefix : 'fp_';

  return {
    at,
    outcome,
    failureCode,
    outputDurationMs: Math.round(outputDurationMs),
    width: Math.round(width),
    height: Math.round(height),
    route,
    elapsedMs: Math.round(elapsedMs),
    planPrefix: prefix,
  };
}

/** Oldest first, at most `limit`: the newest attempts are the ones kept. */
export function capExportLog<T>(entries: readonly T[], limit = EXPORT_LOG_LIMIT): T[] {
  return entries.slice(Math.max(0, entries.length - limit));
}
