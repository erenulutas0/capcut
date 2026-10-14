/**
 * Reads the browser's one stored project (IndexedDB `clip-editor` / `projects`, ADR-012) as a test
 * sees it — for the specs that watch what a wizard's hand-over to the editor writes there
 * (ADR-034 addendum of 13 Oct 2026: `transcript-keep.spec.ts`, `cloud/cloud-keep.spec.ts`).
 */

import type { Page } from '@playwright/test';

export interface Stored {
  title: string;
  edl: { schemaVersion: number; clips: unknown[]; captionTracks: { origin: string; cues: { text: string; speaker?: number }[] }[] };
  bindings: { kind: string; fileName: string }[];
}

/** The project as the browser's store holds it right now (null: nothing stored). */
export function storedRecord(page: Page): Promise<Stored | null> {
  return page.evaluate(
    () =>
      new Promise<Stored | null>((resolve, reject) => {
        const open = indexedDB.open('clip-editor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve(null);
            return;
          }
          const all = db.transaction('projects', 'readonly').objectStore('projects').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve((all.result[0] as Stored | undefined) ?? null);
          };
        };
      }),
  );
}

export interface StoredShape {
  video: string | null;
  clips: number;
  /** Each line's text (one line) and its voice number, or null when no voice is on it. */
  lines: (string | number | null)[][];
}

/** What identifies the stored project in these tests: its video, its kesit count, its lines with their voices. */
export async function storedShape(page: Page): Promise<StoredShape | null> {
  const record = await storedRecord(page);
  if (!record) return null;
  return {
    video: record.bindings.find((binding) => binding.kind === 'video')?.fileName ?? null,
    clips: record.edl.clips.length,
    lines: record.edl.captionTracks[0]?.cues.map((cue) => [cue.text.split('\n').join(' '), cue.speaker ?? null]) ?? [],
  };
}
