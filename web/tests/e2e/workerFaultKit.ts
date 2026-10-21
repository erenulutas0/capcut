/**
 * Test equipment for the small workers' failures (ADR-042, addendum of
 * 13 Oct 2026): the loudness worker, the transcript worker (model download
 * and transcription), the cloud sound worker and the "İyileştir" preview.
 *
 * The break is made on purpose (`window.__clipWorkerFault`, test builds
 * only; see `src/adapters/workerWatch.ts`): the job throws, the worker
 * itself crashes, the job stands still without an error, or the request
 * cannot be handed over. The error's TEXT is given everything a browser's or
 * a library's message could give away — a path with a file name, a caption
 * line, a blob address — and must then be on no screen, in no stored state,
 * in no log line of the app and in no diagnostics file.
 */

import { expect, type Page } from '@playwright/test';

export type FaultKind = 'throw' | 'crash' | 'stall' | 'unsendable' | 'oom';
export type FaultWorker = 'silence' | 'model_download' | 'transcript' | 'cloud_audio' | 'enhance_preview' | 'gif';

export interface Fault {
  worker: FaultWorker;
  kind: FaultKind;
  errorName?: string;
  message?: string;
  /** The GIF worker only: once this many frames of the job were drawn (mid-way), not at its start. */
  atFrame?: number;
}

export const SECRET_PATH = 'C:\\Users\\ayse\\Videos\\aile-tatili-antalya.mp4';
export const SECRET_LINE = 'Doğum günün kutlu olsun Mehmet';
export const SECRET_URL = 'blob:http://127.0.0.1/1f2e3d4c-5b6a-4c7d-8e9f-secretblob00';
/** A known sentence ("Decoding error.") followed by what must never travel. */
export const SECRET_MESSAGE = `Decoding error. ${SECRET_PATH} — ${SECRET_LINE} — ${SECRET_URL}`;
/** Pieces of the above, none of which the app's own screens or files contain. */
export const SECRETS = ['ayse', 'aile-tatili', 'antalya', 'Users\\', 'Videos', 'Doğum günün', 'Mehmet', '1f2e3d4c', 'secretblob'];

/** The fields a failure's detail has — and no others. */
export const DETAIL_KEYS = [
  'attemptInSession',
  'audioEncoder',
  'errorName',
  'framesDone',
  'hardwareEncoderAvailable',
  'hint',
  'pageWasHidden',
  'phase',
  'route',
  'stage',
  'totalFrames',
  'via',
  'videoDecoder',
  'videoEncoder',
  'videoPacketsOut',
].sort();

export const fault = (worker: FaultWorker, kind: FaultKind): Fault => ({ worker, kind, errorName: 'EncodingError', message: SECRET_MESSAGE });

/** Before the page loads: the first job of that worker breaks. */
export async function faultBeforeLoad(page: Page, value: Fault, stallMs?: number): Promise<void> {
  await page.addInitScript(
    ([hook, limit]) => {
      const w = window as unknown as { __clipWorkerFault: unknown; __clipWorkerStallMs?: number };
      w.__clipWorkerFault = hook;
      if (typeof limit === 'number') w.__clipWorkerStallMs = limit;
    },
    [value, stallMs ?? null] as const,
  );
}

/** On the open page: the NEXT job of that worker breaks. */
export async function nextFault(page: Page, value: Fault | null, stallMs?: number): Promise<void> {
  await page.evaluate(
    ([hook, limit]) => {
      const w = window as unknown as { __clipWorkerFault?: unknown; __clipWorkerStallMs?: number };
      if (hook) w.__clipWorkerFault = hook;
      else delete w.__clipWorkerFault;
      if (typeof limit === 'number') w.__clipWorkerStallMs = limit;
      else delete w.__clipWorkerStallMs;
    },
    [value, stallMs ?? null] as const,
  );
}

export interface LogWatch {
  lines: { type: string; text: string }[];
  pageErrors: string[];
}

/** Everything the page and its workers write to the console, from now on. */
export function watchLogs(page: Page): LogWatch {
  const watch: LogWatch = { lines: [], pageErrors: [] };
  page.on('console', (message) => watch.lines.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => watch.pageErrors.push(`${error.name}: ${error.message}`));
  return watch;
}

/**
 * What the browser stores for this site, as text: localStorage,
 * sessionStorage and every row of every IndexedDB store.
 */
export function storedState(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const out: Record<string, unknown> = { local: { ...window.localStorage }, session: { ...window.sessionStorage } };
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        out[`${name}/${store}`] = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      db.close();
    }
    return JSON.stringify(out, (_key, value: unknown) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
      const proto = Object.getPrototypeOf(value) as unknown;
      return proto === Object.prototype || proto === null ? value : `[${(value as object).constructor?.name ?? 'object'}]`;
    });
  });
}

export interface Diagnostics {
  text: string;
  sessionErrors: { at: string; area: string; code: string; detail?: Record<string, unknown> }[];
  exportLog: Record<string, unknown>[];
}

/** Presses the "Sorun bildir" button under a failure's "Ayrıntılar" and reads the whole file as the dialog shows it. */
export async function diagnosticsFrom(page: Page, reportTestId: string): Promise<Diagnostics> {
  await page.getByTestId(reportTestId).click();
  await expect(page.getByTestId('diag-preview')).toHaveAttribute('aria-busy', 'false');
  const text = (await page.getByTestId('diag-preview').textContent()) ?? '';
  const json = JSON.parse(text) as Omit<Diagnostics, 'text'>;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('diag-preview')).toHaveCount(0);
  return { text, ...json };
}

/**
 * The secret is nowhere: not in the page (every element, attribute and text),
 * not in what the browser stores, not in the diagnostics file, not in a log
 * line the app wrote.
 *
 * One line is not the app's: when a worker throws outside every handler (the
 * `crash` fault), the BROWSER reports that uncaught error in its own console,
 * with the text the test itself threw. Nothing of the app reads or repeats
 * it; that one line is left out by its form, and the test says so.
 */
export async function expectNoSecret(page: Page, logs: LogWatch, diagnosticsText: string, label: string): Promise<void> {
  const screen = await page.evaluate(() => document.documentElement.outerHTML);
  const stored = await storedState(page);
  const appLines = logs.lines.filter((line) => !(line.type === 'error' && /^Uncaught /.test(line.text))).map((line) => line.text).join('\n');
  for (const secret of SECRETS) {
    expect(screen, `${label}: the page holds "${secret}"`).not.toContain(secret);
    expect(stored, `${label}: the stored state holds "${secret}"`).not.toContain(secret);
    expect(stored, `${label}: the stored state holds "${secret}" (escaped)`).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(diagnosticsText, `${label}: the diagnostics hold "${secret}"`).not.toContain(secret);
    expect(diagnosticsText, `${label}: the diagnostics hold "${secret}" (escaped)`).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(appLines, `${label}: a log line holds "${secret}"`).not.toContain(secret);
    expect(logs.pageErrors.join('\n'), `${label}: a page error holds "${secret}"`).not.toContain(secret);
  }
}

/**
 * Opens "Ayrıntılar" under a failure (closed until asked for), checks the
 * engineering line, and checks that the session's record in the diagnostics
 * file says the same in checked values — and nothing else.
 */
export async function expectDetail(
  page: Page,
  logs: LogWatch,
  options: {
    /** `<testId>-details`, `<testId>-detail`, `<testId>-report`. */
    testId: string;
    line: RegExp;
    area: string;
    code: string;
    detail: Record<string, unknown>;
    label: string;
  },
): Promise<void> {
  const details = page.getByTestId(`${options.testId}-details`);
  await expect(details).toBeVisible();
  // Engineering words only on request.
  await expect(details).not.toHaveAttribute('open', '');
  await expect(page.getByTestId(`${options.testId}-detail`)).toBeHidden();
  await details.locator('summary').click();
  await expect(page.getByTestId(`${options.testId}-detail`)).toHaveText(options.line);

  const report = await diagnosticsFrom(page, `${options.testId}-report`);
  const row = report.sessionErrors.filter((entry) => entry.area === options.area).at(-1);
  expect(row, `${options.label}: no ${options.area} row in the diagnostics`).toBeDefined();
  expect(row).toMatchObject({ area: options.area, code: options.code, detail: options.detail });
  expect(Object.keys(row?.detail ?? {}).sort()).toEqual(DETAIL_KEYS);
  await expectNoSecret(page, logs, report.text, options.label);
}
