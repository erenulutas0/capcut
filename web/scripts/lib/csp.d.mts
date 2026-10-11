/** Types for csp.mjs (used by the unit tests). */
export declare const CSP_META_MARKER: string;
export function decodeAttribute(value: string): string;
export interface InlineHashes {
  scripts: string[];
  styles: string[];
  hasStyleAttributes: boolean;
}
export function inlineHashes(html: string): InlineHashes;
export interface PolicyOptions {
  /** The one extra origin `connect-src` allows (the transcript proxy, ADR-039); '' or absent: none. */
  connectOrigin?: string;
}
export function buildPolicy(hashes: InlineHashes, options?: PolicyOptions): string;
export function applyCsp(html: string, options?: PolicyOptions): { html: string; policy: string };
