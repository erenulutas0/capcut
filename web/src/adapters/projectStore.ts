'use client';

/**
 * Local project storage (doc 11 "Yerel saklama").
 *
 * IndexedDB holds the EDL and a little metadata — nothing else. No media bytes,
 * no blob URLs, no base64. Storage here is a convenience that the browser may
 * clear or evict at any time, so every failure is reported to the caller and
 * shown to the user rather than swallowed. Nothing in this file may lead the
 * user to believe their work is backed up somewhere.
 */

import { parseRecord, type ProjectRecord } from '@/domain/projectRecord';
import { PROJECTS_STORE, createConnection } from './localDb';

const STORE = PROJECTS_STORE;

export type StoreFailure =
  /** No IndexedDB at all, or opening it threw — e.g. some private modes. */
  | 'unavailable'
  /** The open request was blocked or never answered. */
  | 'blocked'
  /** The browser refused the write because storage is full or capped. */
  | 'quota_exceeded'
  /** Read back something that is not a project we can load. */
  | 'corrupt'
  | 'unknown';

export type SaveResult = { ok: true } | { ok: false; reason: StoreFailure };
export type LoadResult =
  | { ok: true; record: ProjectRecord | null }
  | { ok: false; reason: StoreFailure };

export interface ProjectStore {
  save(record: ProjectRecord): Promise<SaveResult>;
  load(projectId: string): Promise<LoadResult>;
  remove(projectId: string): Promise<SaveResult>;
}

function classify(error: unknown): StoreFailure {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'quota_exceeded';
    if (error.name === 'InvalidStateError' || error.name === 'SecurityError') return 'unavailable';
  }
  return 'unknown';
}

export function createIndexedDbStore(): ProjectStore {
  // Shared schema and version with the export log (see localDb.ts).
  const db = createConnection();

  return {
    async save(record: ProjectRecord): Promise<SaveResult> {
      try {
        const database = await db();
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE, 'readwrite');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error ?? new Error('unknown'));
          transaction.onerror = () => reject(transaction.error ?? new Error('unknown'));
          // Structured clone of plain JSON: no File, no Blob, no object URL.
          transaction.objectStore(STORE).put(JSON.parse(JSON.stringify(record)));
        });
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'unavailable' || message === 'blocked') {
          return { ok: false, reason: message };
        }
        return { ok: false, reason: classify(error) };
      }
    },

    async load(projectId: string): Promise<LoadResult> {
      try {
        const database = await db();
        const raw = await new Promise<unknown>((resolve, reject) => {
          const transaction = database.transaction(STORE, 'readonly');
          const request = transaction.objectStore(STORE).get(projectId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('unknown'));
        });

        if (raw === undefined) return { ok: true, record: null };

        // Stored data is input: an older build or a corrupted row must not be
        // loaded into the editor just because it came from our own database.
        const parsed = parseRecord(raw);
        if (!parsed.ok) return { ok: false, reason: 'corrupt' };
        return { ok: true, record: parsed.record };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'unavailable' || message === 'blocked') {
          return { ok: false, reason: message };
        }
        return { ok: false, reason: classify(error) };
      }
    },

    async remove(projectId: string): Promise<SaveResult> {
      try {
        const database = await db();
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE, 'readwrite');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error ?? new Error('unknown'));
          transaction.objectStore(STORE).delete(projectId);
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: classify(error) };
      }
    },
  };
}
