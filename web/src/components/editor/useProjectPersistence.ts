'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createIndexedDbStore, type StoreFailure } from '@/adapters/projectStore';
import type { ProjectV1 } from '@/domain/edl';
import {
  createRecord,
  parseRecord,
  type AssetBinding,
  type ProjectRecord,
} from '@/domain/projectRecord';

/** doc 10: "Önerilen debounce 500 ms". */
const SAVE_DEBOUNCE_MS = 500;

export type SaveState =
  /** Nothing worth saving yet. */
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  /** A save was attempted and refused; the user must be told. */
  | { kind: 'failed'; reason: StoreFailure };

interface Args {
  project: ProjectV1;
  title: string;
  bindings: AssetBinding[];
  onRestore: (record: ProjectRecord) => void;
}

/**
 * Autosave and restore for the local project (doc 10, doc 11).
 *
 * Deliberate limits, all of them visible to the user rather than hidden:
 * - only the recipe is stored, never media;
 * - a failed save is surfaced, never retried silently into a "saved" state;
 * - "saved" means a transaction committed in THIS browser, which can still be
 *   cleared or evicted. The UI copy says exactly that.
 */
export function useProjectPersistence({ project, title, bindings, onRestore }: Args) {
  const storeRef = useRef(createIndexedDbStore());
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [restored, setRestored] = useState(false);
  const [loadFailure, setLoadFailure] = useState<StoreFailure | null>(null);

  // The save loop reads the latest values through a ref so that typing in the
  // title field does not reschedule the timer on every keystroke.
  const latest = useRef({ project, title, bindings });
  useEffect(() => {
    latest.current = { project, title, bindings };
  }, [project, title, bindings]);

  const createdAtRef = useRef<string | null>(null);
  const restoredRef = useRef(false);

  const persist = useCallback(async (): Promise<void> => {
    const { project: current, title: currentTitle, bindings: currentBindings } = latest.current;
    if (current.clips.length === 0 && currentBindings.length === 0 && currentTitle === '') {
      return;
    }

    setSaveState({ kind: 'saving' });
    const record = createRecord(current.projectId, currentTitle, current, currentBindings);
    if (createdAtRef.current) record.createdAt = createdAtRef.current;
    else createdAtRef.current = record.createdAt;

    const result = await storeRef.current.save(record);
    setSaveState(result.ok ? { kind: 'saved', at: Date.now() } : { kind: 'failed', reason: result.reason });
  }, []);

  // --- restore, once ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await storeRef.current.load(project.projectId);
      if (cancelled) return;

      if (!result.ok) {
        setLoadFailure(result.reason);
        setRestored(true);
        restoredRef.current = true;
        return;
      }
      if (result.record) {
        createdAtRef.current = result.record.createdAt;
        onRestore(result.record);
        setSaveState({ kind: 'saved', at: new Date(result.record.updatedAt).getTime() });
      }
      setRestored(true);
      restoredRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // Runs once for the session's project id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- debounced autosave -------------------------------------------------
  const revision = project.revision;
  const bindingCount = bindings.length;
  useEffect(() => {
    if (!restored) return undefined;
    const timer = window.setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [restored, revision, title, bindingCount, persist]);

  // --- best-effort flush when the tab goes away ---------------------------
  useEffect(() => {
    const flush = () => {
      if (!restoredRef.current) return;
      // Best effort only: the browser may kill the page before this resolves,
      // which is why the UI never promises zero loss.
      void persist();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [persist]);

  /**
   * Warns only about work that is really at risk: a write still in flight, or
   * one the browser refused. A saved project needs no warning, and the browser
   * decides whether to show this at all — we never promise recovery.
   */
  const atRisk = saveState.kind === 'saving' || saveState.kind === 'failed';
  useEffect(() => {
    if (!atRisk) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [atRisk]);

  /** Recovery path required by doc 10 when saving fails. */
  const downloadBackup = useCallback(() => {
    const { project: current, title: currentTitle, bindings: currentBindings } = latest.current;
    const record = createRecord(current.projectId, currentTitle, current, currentBindings);
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const safeTitle = (currentTitle || 'clip-projesi').replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim();
    anchor.download = `${safeTitle || 'clip-projesi'}.clip.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  /** Reads a backup file back in. Validated like any other untrusted input. */
  const importBackup = useCallback(
    async (file: File): Promise<{ ok: true } | { ok: false; reason: string }> => {
      try {
        const text = await file.text();
        const parsed = parseRecord(JSON.parse(text));
        if (!parsed.ok) return { ok: false, reason: parsed.reason };
        createdAtRef.current = parsed.record.createdAt;
        onRestore(parsed.record);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'not_an_object' };
      }
    },
    [onRestore],
  );

  const forget = useCallback(async () => {
    await storeRef.current.remove(latest.current.project.projectId);
    setSaveState({ kind: 'idle' });
  }, []);

  return { saveState, restored, loadFailure, downloadBackup, importBackup, forget, persist };
}
