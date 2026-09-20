/**
 * Undo/redo over domain snapshots.
 *
 * doc 10 asks for at least the last 100 small commands and forbids putting
 * media payloads in history. An EDL snapshot is a few KB of plain JSON, so
 * snapshots are simpler and safer here than inverse commands.
 */

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function commit<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
  };
}

/** Replaces the present without creating an undo step (e.g. live slider drag). */
export function replace<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}
