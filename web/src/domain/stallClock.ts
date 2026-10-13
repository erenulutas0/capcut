/**
 * How long a background job has been silent — counted the way ADR-042 counts
 * it for a download: only while the page is visible. A hidden page's worker
 * may be slowed or paused by the browser, which is not a fault; the time
 * spent hidden is never added, and the count starts again when the page
 * comes back.
 *
 * Pure: the caller passes the clock and says when the page was hidden or
 * shown, so the rule can be tested without a browser.
 */
export class StallClock {
  private lastHeardAt: number;
  private hidden: boolean;
  private everHidden: boolean;

  constructor(now: number, hidden: boolean) {
    this.lastHeardAt = now;
    this.hidden = hidden;
    this.everHidden = hidden;
  }

  /** The job said something (progress, a result part): it is alive. */
  heard(now: number): void {
    this.lastHeardAt = now;
  }

  /** The page was hidden or shown. Either way the count starts again. */
  visibility(hidden: boolean, now: number): void {
    this.hidden = hidden;
    if (hidden) this.everHidden = true;
    this.lastHeardAt = now;
  }

  /** Milliseconds of silence that count; 0 while the page is hidden. */
  silentFor(now: number): number {
    return this.hidden ? 0 : Math.max(0, now - this.lastHeardAt);
  }

  /** Whether the job has stood still longer than `limitMs` (null: this step is not watched). */
  stalled(now: number, limitMs: number | null): boolean {
    return limitMs !== null && this.silentFor(now) > limitMs;
  }

  /** Whether the page was hidden at any time since the job began. */
  get wasHidden(): boolean {
    return this.everHidden;
  }
}
