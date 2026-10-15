/**
 * The ledger: ONE Durable Object instance (SQLite-backed, the only kind the
 * Workers Free plan allows) that owns every number money depends on —
 * invite quotas, the monthly cap, per-IP rate limiting and the job list.
 *
 * Why a Durable Object and not KV: KV is eventually consistent (a write can
 * take up to 60 s to be seen elsewhere) and has no compare-and-swap, so two
 * simultaneous starts could both read "under the cap" and both proceed; the
 * possible overshoot would grow with the number of simultaneous requests. A
 * single Durable Object runs one request at a time and its SQL calls are
 * synchronous, so "check the cap and reserve" is one atomic step: the cap is
 * never passed by a race. (What CAN still exceed a reservation is a file that
 * is longer than its declared length — see README "Tavanın en kötü durumu".)
 *
 * What is stored (and nothing else): invite-code HASHES with their label and
 * minutes; per job a random id, the invite hash, the provider's transcript id
 * (cleared when the transcript is deleted there), declared / reserved / actual
 * seconds, byte count, state and timestamps; per month the total spent; a
 * salted IP hash with a counter for the current hour (purged after the hour).
 * No audio, no transcript text, no file names, no raw IP addresses.
 */
import { DurableObject } from 'cloudflare:workers';

import { type Env, UPLOAD_SLACK_BYTES, costMicro, monthOf, readConfig } from './config';
import { deleteTranscript, getTranscriptStatus } from './provider';

export type Refusal = { ok: false; status: number; code: string; retryAfterS?: number };
export type Reservation = { ok: true; jobId: string; reservedS: number };
export type Quota = { ok: true; on: boolean; remainingS: number; maxJobS: number };

export interface JobRow {
  id: string;
  invite_hash: string;
  month: string;
  state: 'reserved' | 'running' | 'completed' | 'failed';
  transcript_id: string | null;
  declared_s: number;
  reserved_s: number;
  actual_s: number | null;
  reserved_micro: number;
  charged_micro: number;
  bytes: number;
  created_at: number;
  updated_at: number;
  provider_deleted: number;
}

const HOUR_MS = 3600_000;
/** A reservation whose upload never finished (tab closed, Worker error) is given back after this long. */
export const STALE_RESERVATION_MS = 30 * 60_000;
/** A transcript still at the provider this long after the job started is deleted there whatever its state. */
export const MAX_PROVIDER_LIFETIME_MS = 24 * HOUR_MS;
/** Job rows are kept this long for the spend audit, then purged. */
export const JOB_RETENTION_MS = 90 * 24 * HOUR_MS;
/** Actual length may exceed the declared one by this much before the invite is suspended. */
export const OVERRUN_TOLERANCE = { seconds: 3, share: 0.02 };
/**
 * A job deleted while the provider was still working is never seen finished, so its real length is never
 * known. Up to UPLOAD_SLACK_BYTES (64 KB) may arrive on top of what the declared length allows; at 6 kbit/s
 * (Opus's lowest rate, 750 B/s) that is ≈ 88 s of sound the declaration did not mention. Such a job is
 * charged its reservation plus that slack — but never more than its bytes could hold at 6 kbit/s — so a
 * loop of "declare 1 s, send 64 KB, delete before the end" uses up the invite's minutes as fast as it may
 * be spending at the provider (SECURITY.md M5), instead of one second per round.
 */
export const EARLY_DELETE_FLOOR_BYTES_PER_SECOND = 750;
export const EARLY_DELETE_SLACK_S = Math.ceil(UPLOAD_SLACK_BYTES / EARLY_DELETE_FLOOR_BYTES_PER_SECOND);

/** Seconds charged for a job deleted before the provider finished (see EARLY_DELETE_FLOOR_BYTES_PER_SECOND). */
export const earlyDeleteSeconds = (reservedS: number, bytes: number): number =>
  Math.max(reservedS, Math.min(Math.ceil(bytes / EARLY_DELETE_FLOOR_BYTES_PER_SECOND), reservedS + EARLY_DELETE_SLACK_S));
const ALARM_EVERY_MS = 10 * 60_000;

export class Ledger extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, label TEXT NOT NULL, quota_s INTEGER NOT NULL, used_s INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, revoked_reason TEXT);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, invite_hash TEXT NOT NULL, month TEXT NOT NULL, state TEXT NOT NULL, transcript_id TEXT,
        declared_s INTEGER NOT NULL, reserved_s INTEGER NOT NULL, actual_s INTEGER, reserved_micro INTEGER NOT NULL, charged_micro INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, provider_deleted INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS jobs_state ON jobs (state);
      CREATE TABLE IF NOT EXISTS months (month TEXT PRIMARY KEY, spent_micro INTEGER NOT NULL DEFAULT 0, jobs INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rate (ip_hash TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (ip_hash, window));
      CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  // ------------------------------------------------------------ helpers
  private one<T>(query: string, ...bindings: unknown[]): T | null {
    const rows = this.sql.exec(query, ...bindings).toArray();
    return (rows[0] as T | undefined) ?? null;
  }
  private killed(): boolean {
    return this.one<{ value: string }>('SELECT value FROM flags WHERE key = ?', 'kill')?.value === '1';
  }
  private monthSpent(month: string): number {
    return this.one<{ spent_micro: number }>('SELECT spent_micro FROM months WHERE month = ?', month)?.spent_micro ?? 0;
  }
  private monthReserved(month: string): number {
    return this.one<{ total: number | null }>("SELECT SUM(reserved_micro) AS total FROM jobs WHERE month = ? AND state IN ('reserved', 'running')", month)?.total ?? 0;
  }
  private inviteReserved(hash: string): number {
    return this.one<{ total: number | null }>("SELECT SUM(reserved_s) AS total FROM jobs WHERE invite_hash = ? AND state IN ('reserved', 'running')", hash)?.total ?? 0;
  }
  private releaseStale(now: number): void {
    this.sql.exec("UPDATE jobs SET state = 'failed', updated_at = ? WHERE state = 'reserved' AND created_at < ?", now, now - STALE_RESERVATION_MS);
  }
  /**
   * Counts one attempt for this address in the current hour and says whether it is over the limit.
   * Every start counts (right or wrong invite); a quota lookup counts only when its invite is unknown,
   * so guessing codes through `/v1/quota` is as slow as guessing them through `/v1/jobs`.
   */
  private countAttempt(ipHash: string, now: number, limit: number): Refusal | null {
    const window = Math.floor(now / HOUR_MS);
    this.sql.exec('DELETE FROM rate WHERE window < ?', window);
    this.sql.exec('INSERT INTO rate (ip_hash, window, count) VALUES (?, ?, 1) ON CONFLICT (ip_hash, window) DO UPDATE SET count = count + 1', ipHash, window);
    const attempts = this.one<{ count: number }>('SELECT count FROM rate WHERE ip_hash = ? AND window = ?', ipHash, window)?.count ?? 0;
    if (attempts <= limit) return null;
    return { ok: false, status: 429, code: 'rate_limited', retryAfterS: Math.ceil(((window + 1) * HOUR_MS - now) / 1000) };
  }
  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
  }

  // ------------------------------------------------------------ the money path
  /**
   * Atomic: rate limit → switches → invite → one job at a time → invite minutes → monthly cap → reserve.
   * Every attempt counts toward the IP's hourly limit, so guessing invite codes is slow.
   */
  async reserve(input: { inviteHash: string; ipHash: string; declaredS: number; bytes: number; jobId?: string }): Promise<Reservation | Refusal> {
    const config = readConfig(this.env);
    const now = Date.now();
    const result = this.ctx.storage.transactionSync((): Reservation | Refusal => {
      const limited = this.countAttempt(input.ipHash, now, config.rateLimitPerHour);
      if (limited) return limited;
      if (!config.enabled || config.capMicro <= 0 || this.killed()) return { ok: false, status: 503, code: 'cloud_off' };

      const invite = this.one<{ quota_s: number; used_s: number; revoked: number }>('SELECT quota_s, used_s, revoked FROM invites WHERE hash = ?', input.inviteHash);
      if (!invite || invite.revoked) return { ok: false, status: 401, code: 'invite_invalid' };

      this.releaseStale(now);
      const active = this.one<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE invite_hash = ? AND state IN ('reserved', 'running')", input.inviteHash)?.n ?? 0;
      if (active > 0) return { ok: false, status: 409, code: 'job_in_progress' };

      const reservedS = Math.ceil(input.declaredS);
      if (reservedS > config.maxJobSeconds) return { ok: false, status: 413, code: 'too_long' };
      if (invite.used_s + this.inviteReserved(input.inviteHash) + reservedS > invite.quota_s) return { ok: false, status: 402, code: 'invite_minutes_used_up' };

      const month = monthOf(now);
      const cost = costMicro(reservedS, config.priceMicroPerHour);
      if (this.monthSpent(month) + this.monthReserved(month) + cost > config.capMicro) return { ok: false, status: 503, code: 'monthly_cap_reached' };

      // The browser may name the job (a random UUID of its own). A name that exists — whoever owns it — is refused.
      const jobId = input.jobId ?? crypto.randomUUID();
      if (input.jobId && this.one<{ id: string }>('SELECT id FROM jobs WHERE id = ?', jobId)) return { ok: false, status: 409, code: 'job_id_taken' };
      this.sql.exec(
        "INSERT INTO jobs (id, invite_hash, month, state, declared_s, reserved_s, reserved_micro, bytes, created_at, updated_at) VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?)",
        jobId, input.inviteHash, month, reservedS, reservedS, cost, input.bytes, now, now,
      );
      return { ok: true, jobId, reservedS };
    });
    await this.ensureAlarm();
    return result;
  }

  /** The provider accepted the job: remember its id so status, result, delete and the clean-up can find it. */
  async attachTranscript(jobId: string, transcriptId: string): Promise<boolean> {
    const cursor = this.sql.exec("UPDATE jobs SET state = 'running', transcript_id = ?, updated_at = ? WHERE id = ? AND state = 'reserved'", transcriptId, Date.now(), jobId);
    // False: the job was given back meanwhile (the browser deleted it during the upload) — the caller removes the transcript.
    return cursor.rowsWritten > 0;
  }

  /** Still waiting for its upload (not deleted by the browser, not given back)? */
  async isReserved(jobId: string): Promise<boolean> {
    return this.one<{ state: string }>('SELECT state FROM jobs WHERE id = ?', jobId)?.state === 'reserved';
  }

  /** A transcript the provider started for a job that was deleted meanwhile: kept on the job so the clean-up alarm removes it. */
  async rememberOrphan(jobId: string, transcriptId: string): Promise<void> {
    this.sql.exec('UPDATE jobs SET transcript_id = ?, provider_deleted = 0 WHERE id = ?', transcriptId, jobId);
    await this.ensureAlarm();
  }

  /** The start failed before the provider began (nothing billed there): give the reservation back. */
  async release(jobId: string): Promise<void> {
    this.sql.exec("UPDATE jobs SET state = 'failed', updated_at = ? WHERE id = ? AND state IN ('reserved', 'running')", Date.now(), jobId);
  }

  /** A job, but only for the invite that started it. */
  async getJob(jobId: string, inviteHash: string): Promise<JobRow | null> {
    return this.one<JobRow>('SELECT * FROM jobs WHERE id = ? AND invite_hash = ?', jobId, inviteHash);
  }

  /**
   * The provider finished. `completed` charges the provider's own reported
   * length (what it bills) to the month and to the invite; `error` charges
   * nothing (a failed request is not billed, per the provider's billing FAQ).
   * Idempotent: a job is settled once.
   *
   * `actualS: null` means the provider's length is not known: the reservation is charged — or, for a job
   * the browser deleted before the provider finished (`deletedEarly`), the reservation plus the upload's
   * slack (earlyDeleteSeconds). An estimate never suspends the invite; only the provider's own length does.
   */
  async settle(jobId: string, outcome: { status: 'completed'; actualS: number | null; deletedEarly?: boolean } | { status: 'error' }): Promise<JobRow | null> {
    const config = readConfig(this.env);
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const job = this.one<JobRow>('SELECT * FROM jobs WHERE id = ?', jobId);
      if (!job || job.state !== 'running') return job;
      if (outcome.status === 'error') {
        this.sql.exec("UPDATE jobs SET state = 'failed', updated_at = ? WHERE id = ?", now, jobId);
      } else {
        const measured = outcome.actualS !== null;
        const actualS =
          outcome.actualS !== null ? Math.ceil(outcome.actualS) : outcome.deletedEarly ? earlyDeleteSeconds(job.reserved_s, job.bytes) : job.reserved_s;
        const charged = costMicro(actualS, config.priceMicroPerHour);
        this.sql.exec("UPDATE jobs SET state = 'completed', actual_s = ?, charged_micro = ?, updated_at = ? WHERE id = ?", actualS, charged, now, jobId);
        this.sql.exec('UPDATE invites SET used_s = used_s + ? WHERE hash = ?', actualS, job.invite_hash);
        this.sql.exec(
          'INSERT INTO months (month, spent_micro, jobs, seconds) VALUES (?, ?, 1, ?) ON CONFLICT (month) DO UPDATE SET spent_micro = spent_micro + excluded.spent_micro, jobs = jobs + 1, seconds = seconds + excluded.seconds',
          job.month, charged, actualS,
        );
        // A file much longer than declared is either a broken client or abuse: one shot, then the invite is suspended.
        if (measured && actualS > job.declared_s * (1 + OVERRUN_TOLERANCE.share) + OVERRUN_TOLERANCE.seconds) {
          this.sql.exec("UPDATE invites SET revoked = 1, revoked_reason = 'longer_than_declared' WHERE hash = ?", job.invite_hash);
        }
      }
      return this.one<JobRow>('SELECT * FROM jobs WHERE id = ?', jobId);
    });
  }

  /** The transcript no longer exists at the provider: forget its id. */
  async markDeleted(jobId: string): Promise<void> {
    this.sql.exec('UPDATE jobs SET provider_deleted = 1, transcript_id = NULL, updated_at = ? WHERE id = ?', Date.now(), jobId);
  }

  /**
   * Minutes left for an invite. An unknown (or revoked) code counts as an attempt of the address, like a
   * start with a wrong code does: over the hourly limit the answer is `rate_limited`, below it `invite_invalid`.
   * A known code is never counted and never limited here (the card asks on every opening).
   */
  async quota(inviteHash: string, ipHash: string): Promise<Quota | Refusal> {
    const config = readConfig(this.env);
    const now = Date.now();
    return this.ctx.storage.transactionSync((): Quota | Refusal => {
      const invite = this.one<{ quota_s: number; used_s: number; revoked: number }>('SELECT quota_s, used_s, revoked FROM invites WHERE hash = ?', inviteHash);
      if (!invite || invite.revoked) return this.countAttempt(ipHash, now, config.rateLimitPerHour) ?? { ok: false, status: 401, code: 'invite_invalid' };
      const month = monthOf(now);
      const capLeftMicro = config.capMicro - this.monthSpent(month) - this.monthReserved(month);
      const capLeftS = Math.max(0, Math.floor((capLeftMicro * 3600) / config.priceMicroPerHour));
      const inviteLeftS = Math.max(0, invite.quota_s - invite.used_s - this.inviteReserved(inviteHash));
      const on = config.enabled && config.capMicro > 0 && !this.killed();
      return { ok: true, on, remainingS: on ? Math.min(inviteLeftS, capLeftS) : 0, maxJobS: config.maxJobSeconds };
    });
  }

  // ------------------------------------------------------------ admin (founder only)
  async createInvite(hash: string, label: string, quotaS: number): Promise<void> {
    this.sql.exec('INSERT INTO invites (hash, label, quota_s, created_at) VALUES (?, ?, ?, ?)', hash, label, quotaS, Date.now());
  }

  /** Revokes by the first characters of the hash (as shown by `spend`). Returns how many were revoked. */
  async revokeInvite(hashPrefix: string): Promise<number> {
    if (!/^[0-9a-f]{8,64}$/.test(hashPrefix)) return 0;
    const cursor = this.sql.exec("UPDATE invites SET revoked = 1, revoked_reason = 'by_admin' WHERE revoked = 0 AND hash LIKE ?", `${hashPrefix}%`);
    return cursor.rowsWritten;
  }

  async setKill(on: boolean): Promise<void> {
    this.sql.exec("INSERT INTO flags (key, value) VALUES ('kill', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", on ? '1' : '0');
  }

  async spend(): Promise<object> {
    const config = readConfig(this.env);
    const month = monthOf(Date.now());
    const usd = (micro: number) => Number((micro / 1e6).toFixed(4));
    return {
      on: config.enabled && config.capMicro > 0 && !this.killed(),
      enabledVariable: config.enabled,
      killSwitch: this.killed(),
      month,
      capUsd: usd(config.capMicro),
      spentUsd: usd(this.monthSpent(month)),
      reservedUsd: usd(this.monthReserved(month)),
      priceUsdPerHour: usd(config.priceMicroPerHour),
      months: this.sql.exec('SELECT month, spent_micro, jobs, seconds FROM months ORDER BY month DESC LIMIT 12').toArray().map((row) => ({ month: row.month, spentUsd: usd(row.spent_micro as number), jobs: row.jobs, minutes: Number(((row.seconds as number) / 60).toFixed(1)) })),
      invites: this.sql.exec('SELECT hash, label, quota_s, used_s, revoked, revoked_reason FROM invites ORDER BY created_at').toArray().map((row) => ({
        id: (row.hash as string).slice(0, 12),
        label: row.label,
        minutes: Number(((row.quota_s as number) / 60).toFixed(1)),
        usedMinutes: Number(((row.used_s as number) / 60).toFixed(1)),
        revoked: row.revoked === 1 ? (row.revoked_reason ?? true) : false,
      })),
      activeJobs: this.one<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('reserved', 'running')")?.n ?? 0,
      transcriptsStillAtProvider: this.one<{ n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE transcript_id IS NOT NULL AND provider_deleted = 0')?.n ?? 0,
    };
  }

  // ------------------------------------------------------------ clean-up
  /**
   * Every ten minutes while there is anything to clean:
   *  - IP-hash counters of past hours are purged;
   *  - reservations whose upload never finished are given back;
   *  - a finished transcript the browser did not fetch-and-delete within the
   *    result window, and any transcript older than 24 hours, is deleted at the
   *    provider (a still-running one is settled first so the cost is counted);
   *  - job rows older than 90 days are purged.
   */
  async alarm(): Promise<void> {
    const config = readConfig(this.env);
    const now = Date.now();
    this.sql.exec('DELETE FROM rate WHERE window < ?', Math.floor(now / HOUR_MS));
    this.releaseStale(now);
    this.sql.exec('DELETE FROM jobs WHERE created_at < ? AND (transcript_id IS NULL OR provider_deleted = 1)', now - JOB_RETENTION_MS);

    const key = this.env.ASSEMBLYAI_API_KEY;
    if (key) {
      const due = this.sql
        .exec(
          "SELECT * FROM jobs WHERE transcript_id IS NOT NULL AND provider_deleted = 0 AND ((state IN ('completed', 'failed') AND updated_at < ?) OR created_at < ?) LIMIT 20",
          now - config.resultTtlSeconds * 1000,
          now - MAX_PROVIDER_LIFETIME_MS,
        )
        .toArray() as unknown as JobRow[];
      for (const job of due) {
        try {
          if (job.state === 'running') {
            const status = await getTranscriptStatus(config.providerBase, key, job.transcript_id as string);
            if (status.status === 'completed') await this.settle(job.id, { status: 'completed', actualS: status.audioDurationS });
            else if (status.status === 'error') await this.settle(job.id, { status: 'error' });
            else await this.settle(job.id, { status: 'completed', actualS: null }); // still running after 24 h: count the reservation as spent
          }
          await deleteTranscript(config.providerBase, key, job.transcript_id as string);
          await this.markDeleted(job.id);
        } catch {
          // Left for the next alarm; nothing about the job is logged.
        }
      }
    }
    const pending =
      (this.one<{ n: number }>('SELECT COUNT(*) AS n FROM rate')?.n ?? 0) +
      (this.one<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('reserved', 'running') OR (transcript_id IS NOT NULL AND provider_deleted = 0)")?.n ?? 0);
    if (pending > 0) await this.ctx.storage.setAlarm(now + ALARM_EVERY_MS);
  }
}
