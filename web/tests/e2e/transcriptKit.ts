/**
 * Test equipment for "Yazıya dök" (ADR-036).
 *
 * The UI tests cannot afford the real 109 MB model on every run, so they
 * drive the REAL worker, the REAL model store and the REAL wizard against two
 * clearly marked test doubles, switched on only in a `CLIP_TEST_HOOKS=1`
 * build (never the published site):
 *
 * - a tiny model list (`testManifest`) whose files this kit serves itself
 *   (`serveModels`): download, parts and Range, sha256 check, resume and
 *   delete all run through the shipped code, on kilobytes instead of
 *   megabytes;
 * - a scripted stand-in for the recogniser (`STUB_SCRIPT`): it posts fixed
 *   segments through the same worker protocol. It hears nothing.
 *
 * What the real model writes is tested separately, with the real files
 * (`transcript-real.spec.ts`, and the Pages smoke test).
 */

import { createHash } from 'node:crypto';
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test';

const S = 1_000_000;

export interface TestFile {
  path: string;
  body: Buffer;
}

function bytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');

/** Small enough to be instant, large enough that the big file needs two parts (32 MiB each). */
export const BIG_BYTES = 33 * 1024 * 1024 + 4321;

export interface TestModels {
  manifest: unknown;
  /** `<dir>/<path>` → the bytes this kit serves. */
  files: Map<string, Buffer>;
  totalBytes: (model: 'base' | 'turbo') => number;
}

/** A model list of tiny files; `big` adds one file of two parts to the base model (Range, resume). */
export function testModels(options: { big?: boolean } = {}): TestModels {
  const groups = {
    runtime: { dir: 'runtime-test', files: [{ path: 'runtime.wasm', body: bytes(40_000, 1) }] },
    vad: { dir: 'vad-test', files: [{ path: 'onnx/model.onnx', body: bytes(20_000, 2) }] },
    base: {
      dir: 'base-test',
      files: [
        { path: 'config.json', body: Buffer.from('{"test":true}') },
        { path: 'onnx/encoder.onnx', body: options.big ? bytes(BIG_BYTES, 3) : bytes(300_000, 3) },
      ],
    },
    turbo: { dir: 'turbo-test', files: [{ path: 'onnx/encoder.onnx', body: bytes(900_000, 4) }] },
  };
  const files = new Map<string, Buffer>();
  const manifest = {
    storeVersion: 1,
    groups: Object.fromEntries(
      Object.entries(groups).map(([id, group]) => [
        id,
        {
          dir: group.dir,
          files: group.files.map((file) => {
            files.set(`${group.dir}/${file.path}`, file.body);
            return { path: file.path, bytes: file.body.length, sha256: sha(file.body) };
          }),
        },
      ]),
    ),
  };
  const sizeOf = (id: keyof typeof groups) => groups[id].files.reduce((sum, file) => sum + file.body.length, 0);
  return { manifest, files, totalBytes: (model) => sizeOf('runtime') + sizeOf('vad') + sizeOf(model) };
}

export interface ModelRequest {
  key: string;
  range: string | null;
}

export interface ModelServer {
  requests: ModelRequest[];
  /** Change what is served for one file (a damaged copy, a dropped connection, a host that ignores Range). */
  behave(key: string, behaviour: 'ok' | 'corrupt' | 'abort' | 'abort-second-part' | 'ignore-range' | 'not-found'): void;
}

/** Serves the test model files at `<site>/models/…`, the way a static host does (Range → 206). */
export async function serveModels(context: BrowserContext, models: TestModels): Promise<ModelServer> {
  const requests: ModelRequest[] = [];
  const behaviours = new Map<string, string>();
  await context.route('**/models/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.slice(url.pathname.indexOf('/models/') + '/models/'.length);
    const range = route.request().headers().range ?? null;
    requests.push({ key, range });
    const body = models.files.get(key);
    const behaviour = behaviours.get(key) ?? 'ok';
    if (!body || behaviour === 'not-found') return route.fulfill({ status: 404, body: 'not found' });
    if (behaviour === 'abort') return route.abort('connectionreset');
    const served = behaviour === 'corrupt' ? Buffer.from(body.map((value, index) => (index === 10 ? value ^ 0xff : value))) : body;
    const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (match && behaviour !== 'ignore-range') {
      const start = Number(match[1]);
      const end = Math.min(served.length - 1, Number(match[2]));
      if (behaviour === 'abort-second-part' && start > 0) return route.abort('connectionreset');
      return route.fulfill({
        status: 206,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${served.length}`, 'Accept-Ranges': 'bytes' },
        body: served.subarray(start, end + 1),
      });
    }
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' }, body: served });
  });
  return { requests, behave: (key, behaviour) => void behaviours.set(key, behaviour) };
}

interface StubWord {
  startUs: number;
  endUs: number;
  text: string;
}
function words(text: string, fromS: number, eachS = 0.35): StubWord[] {
  return text.split(' ').map((item, index) => ({
    text: item,
    startUs: Math.round((fromS + index * eachS) * S),
    endUs: Math.round((fromS + (index + 1) * eachS - 0.03) * S),
  }));
}

/**
 * What the stand-in "hears" in the 24-second sample: three stretches of
 * speech and one that could not be written. The wizard's own rules then make
 * the lines (so the test also sees the real segmentation and the real track).
 */
export const STUB_SCRIPT = {
  stepMs: 120,
  segments: [
    { startUs: 1 * S, endUs: 4 * S, state: 'ok', words: words('Hello and welcome to the show.', 1.1) },
    { startUs: 6 * S, endUs: 8 * S, state: 'unclear', words: [] },
    {
      startUs: 9 * S,
      endUs: 16 * S,
      state: 'ok',
      words: words('Today we cut a video by its text, which is the fastest way to find a moment.', 9.2),
    },
    { startUs: 18 * S, endUs: 20.5 * S, state: 'ok', words: words('Thanks for watching.', 18.3) },
  ],
};

/** The lines the stub script becomes (the app's segmentation rules, checked by hand). */
export const STUB_LINES = [
  'Hello and welcome to the show.',
  '(anlaşılamadı)',
  'Today we cut a video by its text,',
  'which is the fastest way to find a moment.',
  'Thanks for watching.',
];

/** Puts the test doubles on the page before it loads. `stub: null` keeps the real recogniser. */
export async function installTranscriptTest(
  page: Page,
  models: TestModels | null,
  stub: unknown | null = STUB_SCRIPT,
): Promise<void> {
  await page.addInitScript(
    (hook) => {
      (window as unknown as { __clipTranscriptTest: unknown }).__clipTranscriptTest = hook;
    },
    { ...(models ? { manifest: models.manifest } : {}), ...(stub ? { stub } : {}) },
  );
}

/** This suite drives test doubles: it must run against the e2e build, and says so instead of passing by accident. */
export async function expectTestBuild(page: Page): Promise<void> {
  const steps = page.getByTestId('transcribe-steps');
  await expect(steps).toBeVisible({ timeout: 60_000 });
  expect(
    await steps.getAttribute('data-test-hooks'),
    'these tests need the e2e build: CLIP_TEST_HOOKS=1 npm run build',
  ).toBe('1');
}

export const panelLines = (page: Page) => page.getByTestId('transcript-row');

export async function lineTexts(page: Page): Promise<string[]> {
  return page.locator('[data-testid="transcript-row"] .transcript-text').allTextContents();
}
