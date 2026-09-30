export interface PrecacheEntry {
  url: string;
  file: string;
}

export interface PrecacheList {
  pages: PrecacheEntry[];
  assets: PrecacheEntry[];
}

export function isOfflineAsset(rel: string): boolean;
export function collectPrecache(options: { webDir: string; mode: 'export' | 'server'; base?: string }): PrecacheList;
export function precacheVersion(list: PrecacheList, template: string): string;
export function renderServiceWorker(
  template: string,
  config: { version: string; base: string; pages: string[]; assets: string[] },
): string;
