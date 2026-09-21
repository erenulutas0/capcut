/**
 * Our temporary export files in the browser's private file system (OPFS).
 *
 * Kept free of media imports on purpose: the page uses it to delete a file it
 * no longer offers for download, and must not pull the encoder library into
 * the editor bundle just to do that.
 */

/** Prefix for our temporary files, so a sweep never touches anything else. */
export const EXPORT_ENTRY_PREFIX = 'clip-export-';

/** A leftover from a crashed or closed tab is removed after this long. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

export async function removeExportEntry(name: string): Promise<void> {
  if (!name.startsWith(EXPORT_ENTRY_PREFIX)) return;
  const root = await opfsRoot();
  if (!root) return;
  await root.removeEntry(name).catch(() => undefined);
}

/**
 * Deletes export files old enough that no tab can still be offering them for
 * download — the leftovers of a tab that was closed or crashed.
 */
export async function sweepExportEntries(): Promise<number> {
  const root = await opfsRoot();
  if (!root) return 0;

  let removed = 0;
  const entries = (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const [name, handle] of entries) {
    if (!name.startsWith(EXPORT_ENTRY_PREFIX) || handle.kind !== 'file') continue;
    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      if (Date.now() - file.lastModified < STALE_AFTER_MS) continue;
      await root.removeEntry(name);
      removed += 1;
    } catch {
      // A file another tab is still writing cannot be touched; leave it.
    }
  }
  return removed;
}

/** Lists our export files; used by tests to prove nothing is left behind. */
export async function listExportEntries(): Promise<string[]> {
  const root = await opfsRoot();
  if (!root) return [];
  const names: string[] = [];
  const entries = (root as unknown as { keys(): AsyncIterable<string> }).keys();
  for await (const name of entries) {
    if (name.startsWith(EXPORT_ENTRY_PREFIX)) names.push(name);
  }
  return names;
}
