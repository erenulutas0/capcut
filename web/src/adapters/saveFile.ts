/**
 * The browser's save dialog (File System Access API, Chromium; ADR-026),
 * shared by the video downloads (`useDownloads`) and "GIF yap" (ADR-046).
 * Where the browser has no save dialog, the caller offers the finished file
 * with a download link instead.
 */

/** The save dialog of the File System Access API. */
export type SavePicker = (options: {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<FileSystemFileHandle>;

/** The save dialog, or null where the browser has none. Must be CALLED inside the click (user activation). */
export function savePicker(): SavePicker | null {
  const picker = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof picker === 'function' ? (picker as SavePicker).bind(globalThis) : null;
}

/** The save dialog creates the chosen file; if it is still empty, remove it again. */
export async function removeEmptyPick(handle: FileSystemFileHandle): Promise<void> {
  const removable = handle as FileSystemFileHandle & { remove?: () => Promise<void> };
  // A worker that was stopped mid-write (it crashed) still holds the file for a
  // moment after it is gone; the browser refuses the removal until then
  // (measured: the empty file stayed behind). A few short tries cover that.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const file = await handle.getFile();
      if (file.size === 0) await removable.remove?.();
      return;
    } catch (error) {
      // Gone already: nothing to clean up.
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  // Still held, or no permission to remove it; the file is empty either way.
}
