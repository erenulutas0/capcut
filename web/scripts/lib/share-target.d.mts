/** Types for share-target.mjs (the page's adapter and the unit tests use it). */
export declare const SHARE_CACHE: string;
export declare const SHARE_TTL_MS: number;
export declare const SHARE_ACTION_PATH: string;
export declare const SHARE_PARAM: string;
export declare const SHARE_ERROR_PARAM: string;
export declare const SHARE_PICKED_ID: string;
export type ShareError = 'video-degil' | 'bos' | 'yer' | 'okunamadi';
export declare const SHARE_ERRORS: ShareError[];

/** The part of Cache Storage the inbox uses (the browser's `caches`, or a stand-in in a test). */
export interface ShareCaches {
  has(name: string): Promise<boolean>;
  open(name: string): Promise<{
    keys(): Promise<ReadonlyArray<{ url: string }>>;
    match(request: { url: string } | string): Promise<Response | undefined>;
    put(request: string, response: Response): Promise<void>;
    delete(request: { url: string } | string): Promise<boolean>;
  }>;
  delete(name: string): Promise<boolean>;
}

export interface ShareEntryFacts {
  name: string;
  type: string;
  lastModified: number;
  sharedAt: number;
  /** How many files the share brought (only the first video is kept). */
  count: number;
}

export function shareEntryPath(base: string, id: string): string;
export function isVideoFile(file: { name: string; type?: string }): boolean;
export function chooseSharedVideo(form: { entries(): Iterable<[string, unknown]> }): { video: File | null; count: number };
export function shareRedirect(base: string, outcome: { id: string } | { error: ShareError }): string;
export function newShareId(now: number, random: number): string;
export function receiveShare(options: {
  request: { formData(): Promise<FormData> };
  cachesApi: ShareCaches;
  base: string;
  now: number;
  random: number;
}): Promise<string>;
export function readShareMarker(search: string): { id: string } | { error: ShareError } | null;
export function readShareEntry(response: Response): ShareEntryFacts | null;
export function shareExpired(sharedAt: number, now: number): boolean;
export function sweepShares(options: { cachesApi: ShareCaches; now: number; keep?: string }): Promise<number>;
export function forgetShare(options: { cachesApi: ShareCaches; base: string; id: string }): Promise<boolean>;
