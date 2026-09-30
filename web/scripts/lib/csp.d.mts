/** Types for csp.mjs (used by the unit tests). */
export declare const CSP_META_MARKER: string;
export function decodeAttribute(value: string): string;
export interface InlineHashes {
  scripts: string[];
  styles: string[];
  hasStyleAttributes: boolean;
}
export function inlineHashes(html: string): InlineHashes;
export function buildPolicy(hashes: InlineHashes): string;
export function applyCsp(html: string): { html: string; policy: string };
