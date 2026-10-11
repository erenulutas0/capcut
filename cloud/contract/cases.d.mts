export interface ContractResponse {
  status: number;
  headers: { get(name: string): string | null };
  text: string;
}
export interface ContractDriver {
  origin: string;
  limits: { rateLimitPerHour: number; monthlyCapUsd: number; priceUsdPerHour: number };
  send(path: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array }): Promise<ContractResponse>;
  newInvite(minutes: number): Promise<string>;
  kill(on: boolean): Promise<void>;
  provider(config: Record<string, unknown>): Promise<void>;
  providerState(): Promise<{ transcripts: { deleted: boolean }[]; uploads: number }>;
}
export const CONTRACT_CASES: { name: string; run: (driver: ContractDriver) => Promise<void> }[];
export function equal(actual: unknown, expected: unknown, what: string): void;
export function webm(bytes?: number): Uint8Array;
