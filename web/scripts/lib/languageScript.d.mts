/** Types for languageScript.mjs (used by the unit tests). */
export declare const LANGUAGE_MARKER: string;
export declare const LANGUAGE_STORAGE_KEY: string;

export interface LanguageConfig {
  base: string;
  slash: boolean;
  key: string;
  showAfterMs: number;
}

export function languageConfig(base?: string, slash?: boolean): LanguageConfig;
export function languageScript(base?: string, slash?: boolean, template?: string): string;
export function hasTwin(rel: string): boolean;
export function insertLanguageScript(html: string, script: string): string;
