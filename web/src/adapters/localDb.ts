'use client';

/**
 * The one IndexedDB database this app uses ('clip-editor'), shared by the
 * project store and the local export log.
 *
 * Both stores must open the database with the SAME version and the SAME
 * upgrade step: IndexedDB refuses to open an older version than the one on
 * disk, so two modules with their own idea of the schema would lock each
 * other out. That is why the schema lives here and nowhere else.
 *
 * Version history:
 *   1  'projects'  — the project record (EDL + file recognition data).
 *   2  'exportLog' — the last 20 export attempts, numbers only (no names,
 *                    no caption text, no media). Added without touching
 *                    'projects', so a v1 database keeps its project.
 */

export const DB_NAME = 'clip-editor';
export const DB_VERSION = 2;
export const PROJECTS_STORE = 'projects';
export const EXPORT_LOG_STORE = 'exportLog';

const OPEN_TIMEOUT_MS = 8_000;

/** The part of IDBDatabase the upgrade needs; lets the unit test use a fake. */
export interface UpgradeTarget {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: IDBObjectStoreParameters): unknown;
}

/**
 * Brings any older database up to DB_VERSION. Only ever ADDS stores: an
 * upgrade that deleted or rewrote 'projects' would lose the user's recipe,
 * which is the one thing this database exists to keep. Each step checks for
 * the store first, so running it on a half-upgraded database is harmless.
 */
export function upgradeSchema(db: UpgradeTarget): void {
  if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
    db.createObjectStore(PROJECTS_STORE, { keyPath: 'projectId' });
  }
  if (!db.objectStoreNames.contains(EXPORT_LOG_STORE)) {
    db.createObjectStore(EXPORT_LOG_STORE, { keyPath: 'id', autoIncrement: true });
  }
}

export function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('unavailable'));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      // Some private-browsing modes throw here instead of returning a request.
      reject(error);
      return;
    }

    // An open that is blocked by another tab's older version never fires
    // success or error; without this the editor would wait forever.
    const timer = setTimeout(() => reject(new Error('blocked')), OPEN_TIMEOUT_MS);
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };

    request.onupgradeneeded = () => upgradeSchema(request.result);
    request.onsuccess = () =>
      settle(() => {
        const db = request.result;
        // A newer build in another tab needs this connection gone to upgrade.
        // Closing lets it proceed; our callers reopen on the next use.
        db.onversionchange = () => db.close();
        resolve(db);
      });
    request.onerror = () => settle(() => reject(request.error ?? new Error('unknown')));
    request.onblocked = () => settle(() => reject(new Error('blocked')));
  });
}

/**
 * A lazily opened connection that is dropped when it closes — storage
 * cleared underneath us (`close`) or handed over to a newer build
 * (`versionchange`) — so the next call opens a fresh one instead of using a
 * dead handle.
 */
export function createConnection(): () => Promise<IDBDatabase> {
  let cached: IDBDatabase | null = null;
  return async () => {
    if (cached) return cached;
    const db = await openLocalDatabase();
    const forget = () => {
      if (cached === db) cached = null;
    };
    db.addEventListener('close', forget);
    db.addEventListener('versionchange', forget);
    cached = db;
    return db;
  };
}
