/**
 * Remembers WHERE in the export an error was raised, without touching the
 * error: the stage is kept beside it (a WeakMap), so the error object that
 * travels up is the one that was thrown, and nothing of its text is copied.
 *
 * The first tag wins: the innermost step that saw the error names it (a
 * failed disk write that surfaces through the encoder's next `add` stays a
 * `write`).
 */

import type { ExportStage } from '@/domain/exportFailureDetail';

const stages = new WeakMap<object, ExportStage>();

/** Notes the stage of `error` (unless it has one) and returns the same error, to be thrown on. */
export function tagStage<T>(error: T, stage: ExportStage): T {
  if (typeof error === 'object' && error !== null && !stages.has(error)) stages.set(error, stage);
  return error;
}

export function stageOf(error: unknown): ExportStage | null {
  return typeof error === 'object' && error !== null ? (stages.get(error) ?? null) : null;
}

/**
 * A worker often answers with an error of its own that names the reason in
 * plain words ("undecodable") — and the error that really happened is gone.
 * `withOrigin` keeps it beside the new one (never inside it, never as text),
 * so the failure's detail can still say its name and stage.
 */
const origins = new WeakMap<object, unknown>();

/** Notes that `wrapper` stands for `origin`, and returns `wrapper`, to be thrown. */
export function withOrigin<T extends object>(wrapper: T, origin: unknown): T {
  // The first origin is the real one: a wrapper of a wrapper leads back to it.
  origins.set(wrapper, originOf(origin) ?? origin);
  return wrapper;
}

/**
 * `wrapper` replaces `from`, which is one of our own plain-word errors: if
 * `from` stood for a real error, `wrapper` now stands for the same one; if it
 * was a refusal of its own (no sound track), `wrapper` is one too.
 */
export function passOrigin<T extends object>(wrapper: T, from: unknown): T {
  const origin = originOf(from);
  if (origin !== undefined) origins.set(wrapper, origin);
  return wrapper;
}

/** The error `error` stands for; undefined when it stands for nothing but itself. */
export function originOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && origins.has(error) ? origins.get(error) : undefined;
}

/** Runs one step; an error out of it is tagged with `stage`. */
export async function staged<T>(stage: ExportStage, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw tagStage(error, stage);
  }
}

/**
 * Passes `source` through; an error raised while WAITING for its next item is
 * tagged with `stage`. Errors of whoever consumes the items never pass
 * through here (a consumer that stops early ends the source, as before).
 */
export async function* stagedIterable<T>(source: AsyncIterable<T>, stage: ExportStage): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let finished = false;
  try {
    for (;;) {
      let next: IteratorResult<T>;
      try {
        next = await iterator.next();
      } catch (error) {
        finished = true;
        throw tagStage(error, stage);
      }
      if (next.done) {
        finished = true;
        return;
      }
      yield next.value;
    }
  } finally {
    // The consumer stopped early: let the source release what it holds.
    if (!finished) await iterator.return?.();
  }
}
