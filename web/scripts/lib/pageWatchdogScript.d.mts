/** Types for pageWatchdogScript.mjs (used by the unit tests). */
export declare const WATCHDOG_MARKER: string;

export interface WatchdogConfig {
  key: string;
  aliveAttr: string;
  pendingAttr: string;
  noticeId: string;
  staticPrefix: string;
  scope: string;
  cachePrefix: string;
  enPrefix: string;
  graceS: number;
  errorS: number;
  stuckS: number;
  quietMs: number;
}

export function watchdogConfig(base?: string): WatchdogConfig;
export function watchdogScript(base?: string, template?: string): string;
export function insertWatchdog(html: string, script: string): string;
