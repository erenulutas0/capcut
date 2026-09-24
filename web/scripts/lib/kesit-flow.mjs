/**
 * Driving the kesit editor (ADR-026) from the measurement scripts: the same
 * steps a user takes, shared so every script drives the app the same way.
 *
 * The real save dialog (`showSaveFilePicker`) is an operating-system window a
 * script cannot drive. `installSavePicker` replaces it, before the page
 * loads, with one that hands out a file in the page's own private storage
 * (OPFS): the same `FileSystemFileHandle`, the same `createWritable()`, sent
 * to the export worker the same way. `readPickedFile` then copies that file
 * out to disk for ffprobe/ffmpeg. `removeSavePicker` drives the fallback
 * route ("Bilgisayara kaydet") instead.
 */
import { closeSync, openSync, writeSync } from 'node:fs';

/** Must run before the page loads (it is an init script). */
export async function installSavePicker(page) {
  await page.addInitScript(() => {
    window.__pickerCalls = [];
    window.showSaveFilePicker = async (options) => {
      window.__pickerCalls.push(options.suggestedName);
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle(`picked-${Date.now()}-${options.suggestedName}`, { create: true });
    };
  });
}

export async function removeSavePicker(page) {
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
    delete Window.prototype.showSaveFilePicker;
  });
}

/** Types Başlangıç and Bitiş and presses "Kesit ekle". */
export async function addKesit(page, start, end) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

/** Opens Ayarlar on a tab ('frame' | 'audio' | 'captions'). */
export async function openSettings(page, tab = 'frame') {
  await page.getByTestId('open-settings').click();
  await page.getByTestId(`inspector-tab-${tab}`).click();
}

export async function closeSheet(page) {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
}

export async function setQuality(page, shortEdge) {
  await openSettings(page, 'frame');
  await page.getByTestId('export-quality').selectOption(String(shortEdge));
  await closeSheet(page);
}

export async function setAspect(page, aspect) {
  await openSettings(page, 'frame');
  await page.getByTestId(`aspect-${aspect}`).click();
  await closeSheet(page);
}

/** The name the picked file got in OPFS (the latest one), or null. */
export async function lastPickedName(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let newest = null;
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'file' && name.startsWith('picked-') && (newest === null || name > newest)) newest = name;
    }
    return newest;
  });
}

/** Copies a picked file from the page's OPFS to `savePath`, 8 MiB at a time. */
export async function readPickedFile(page, name, savePath) {
  const chunk = 8 * 1024 * 1024;
  const size = await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle(fileName)).getFile()).size;
  }, name);
  const fd = openSync(savePath, 'w');
  try {
    for (let offset = 0; offset < size; offset += chunk) {
      const base64 = await page.evaluate(
        async ({ fileName, from, length }) => {
          const root = await navigator.storage.getDirectory();
          const file = await (await root.getFileHandle(fileName)).getFile();
          const bytes = new Uint8Array(await file.slice(from, from + length).arrayBuffer());
          let text = '';
          for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(text);
        },
        { fileName: name, from: offset, length: chunk },
      );
      writeSync(fd, Buffer.from(base64, 'base64'));
    }
  } finally {
    closeSync(fd);
  }
  return size;
}

/** Deletes the picked files from OPFS (they are copies the script already saved). */
export async function removePickedFiles(page) {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names = [];
    for await (const [name] of root.entries()) if (name.startsWith('picked-')) names.push(name);
    for (const name of names) await root.removeEntry(name).catch(() => undefined);
  });
}
