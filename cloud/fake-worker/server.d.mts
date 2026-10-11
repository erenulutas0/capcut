/** A word as the provider reports it: times in milliseconds, the speaker as a letter. */
export interface FakeWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: string | null;
}

export interface FakeProviderConfig {
  pollsUntilDone?: number;
  failUpload?: number;
  failCreate?: number;
  transcriptError?: string | null;
  audioDurationS?: number | null;
  words?: FakeWord[];
  languageCode?: string | null;
  failStatus?: number;
  failResult?: number;
  holdUpload?: boolean;
  dropUploadAfterBytes?: number;
}

export interface FakeRequest {
  method: string;
  path: string;
  query: string;
  origin: string | null;
  hasInvite: boolean;
  contentType: string | null;
  durationS: string | null;
  language: string | null;
  jobIdHeader: string | null;
  bytes: number;
  /** HTTP status answered; -1 when the browser went away first; 0 while unanswered. */
  status: number;
}

export interface FakeUpload {
  jobId: string;
  bytes: Buffer;
  contentType: string;
  durationS: number;
  language: string;
}

export interface FakeWorker {
  port: number;
  url: string;
  limits: { rateLimitPerHour: number; monthlyCapUsd: number; priceUsdPerHour: number };
  reset(): void;
  newInvite(minutes?: number): string;
  revokeInvite(code: string): void;
  kill(on: boolean): void;
  provider(config: FakeProviderConfig): void;
  releaseUpload(): void;
  providerState(): { transcripts: { deleted: boolean }[]; uploads: number };
  readonly requests: FakeRequest[];
  readonly uploads: FakeUpload[];
  readonly abortedUploads: number;
  jobs(): { id: string; state: 'reserved' | 'running' | 'completed' | 'failed'; atProvider: boolean; reservedS: number; actualS: number | null }[];
  close(): Promise<void>;
}

export const DEFAULT_WORDS: FakeWord[];

export function startFakeWorker(options?: {
  port?: number;
  allowedOrigins: string[];
  monthlyCapUsd?: number;
  priceUsdPerHour?: number;
  rateLimitPerHour?: number;
  maxJobMinutes?: number;
  maxBytesPerSecond?: number;
}): Promise<FakeWorker>;
