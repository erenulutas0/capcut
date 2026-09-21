'use client';

/**
 * The local export log in IndexedDB (store 'exportLog' of 'clip-editor').
 *
 * Nothing here is ever sent anywhere. The log exists so that a user who
 * reports a problem can choose to attach it to a diagnostics file; the
 * privacy page says so and offers to clear it.
 *
 * Logging is best effort by design: a browser that refuses the write (private
 * mode, full disk) must not turn a successful export into a failure, so every
 * operation swallows its error and reports a plain boolean or empty list.
 */

import {
  EXPORT_LOG_LIMIT,
  sanitizeExportLogEntry,
  type ExportLogEntry,
} from '@/domain/exportLog';
import { EXPORT_LOG_STORE, createConnection } from './localDb';

/** Storage primitives; the IndexedDB one below, an in-memory one in tests. */
export interface ExportLogBackend {
  add(entry: ExportLogEntry): Promise<void>;
  /** Ascending, i.e. oldest first (auto-increment keys). */
  keys(): Promise<number[]>;
  remove(keys: readonly number[]): Promise<void>;
  /** Ascending by key. */
  all(): Promise<unknown[]>;
  clear(): Promise<void>;
}

export interface ExportLog {
  append(entry: ExportLogEntry): Promise<boolean>;
  read(): Promise<ExportLogEntry[]>;
  clear(): Promise<boolean>;
}

export function createExportLog(backend: ExportLogBackend, limit = EXPORT_LOG_LIMIT): ExportLog {
  return {
    async append(entry) {
      try {
        await backend.add(entry);
        // Trim after every write, so the log can never grow past the limit,
        // even if an earlier trim was interrupted by a closed tab.
        const keys = await backend.keys();
        if (keys.length > limit) await backend.remove(keys.slice(0, keys.length - limit));
        return true;
      } catch {
        return false;
      }
    },
    async read() {
      try {
        const rows = await backend.all();
        const entries = rows
          .map(sanitizeExportLogEntry)
          .filter((entry): entry is ExportLogEntry => entry !== null);
        return entries.slice(Math.max(0, entries.length - limit));
      } catch {
        return [];
      }
    },
    async clear() {
      try {
        await backend.clear();
        return true;
      } catch {
        return false;
      }
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('unknown'));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('unknown'));
  });
}

export function indexedDbExportLogBackend(): ExportLogBackend {
  const db = createConnection();
  return {
    async add(entry) {
      const transaction = (await db()).transaction(EXPORT_LOG_STORE, 'readwrite');
      // A plain copy of the known fields only; the key is added by the store.
      transaction.objectStore(EXPORT_LOG_STORE).add({ ...entry });
      await done(transaction);
    },
    async keys() {
      const transaction = (await db()).transaction(EXPORT_LOG_STORE, 'readonly');
      const keys = await requestResult(transaction.objectStore(EXPORT_LOG_STORE).getAllKeys());
      return keys.filter((key): key is number => typeof key === 'number').sort((a, b) => a - b);
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const transaction = (await db()).transaction(EXPORT_LOG_STORE, 'readwrite');
      const store = transaction.objectStore(EXPORT_LOG_STORE);
      for (const key of keys) store.delete(key);
      await done(transaction);
    },
    async all() {
      const transaction = (await db()).transaction(EXPORT_LOG_STORE, 'readonly');
      return requestResult(transaction.objectStore(EXPORT_LOG_STORE).getAll());
    },
    async clear() {
      const transaction = (await db()).transaction(EXPORT_LOG_STORE, 'readwrite');
      transaction.objectStore(EXPORT_LOG_STORE).clear();
      await done(transaction);
    },
  };
}

let shared: ExportLog | null = null;

/** The page-wide log. Created lazily: server rendering never touches it. */
export function exportLog(): ExportLog {
  shared ??= createExportLog(indexedDbExportLogBackend());
  return shared;
}
