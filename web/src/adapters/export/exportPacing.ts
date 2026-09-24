/**
 * Keeps a segment's audio work next to its video work (ADR-028).
 *
 * The encode worker used to write a segment's audio only after all of its
 * frames, so for the length of the audio work the video encoder sat idle
 * (measured: ~6% of a Chrome export). Audio now runs alongside the frames,
 * in the time the worker would otherwise spend waiting for the video
 * encoder. It is paced: a chunk of audio waits until the video has reached
 * its output time minus a small lead, so both tracks are written to the file
 * close together and neither side buffers more than a moment of work.
 *
 * Pure bookkeeping, no timers: `advance` is called by the frame loop, and
 * every waiter whose time has been reached is released.
 */

export class MediaPacer {
  private position = Number.NEGATIVE_INFINITY;
  private finished = false;
  private stopped = false;
  private waiters: { until: number; resolve: () => void }[] = [];

  /** @param leadSeconds how far audio may run ahead of the video. */
  constructor(private readonly leadSeconds: number) {}

  /** The video has produced everything before `seconds` (output time). */
  advance(seconds: number): void {
    if (seconds <= this.position) return;
    this.position = seconds;
    this.release();
  }

  /** The video of this segment is complete: nothing waits any more. */
  finish(): void {
    this.finished = true;
    this.release();
  }

  /** The export is ending early: waiters are released and told to stop. */
  stop(): void {
    this.stopped = true;
    this.finish();
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Resolves once the video is within `leadSeconds` of `seconds` (or done).
   * Resolves at once when that is already true, without yielding.
   */
  until(seconds: number): Promise<void> | null {
    if (this.reached(seconds)) return null;
    return new Promise<void>((resolve) => {
      this.waiters.push({ until: seconds, resolve });
    });
  }

  private reached(seconds: number): boolean {
    return this.finished || seconds - this.leadSeconds <= this.position;
  }

  private release(): void {
    if (this.waiters.length === 0) return;
    const waiting: typeof this.waiters = [];
    for (const waiter of this.waiters) {
      if (this.reached(waiter.until)) waiter.resolve();
      else waiting.push(waiter);
    }
    this.waiters = waiting;
  }
}
