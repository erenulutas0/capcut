/**
 * The measurement set: what the founder wants measured, and which file stands
 * for each case (`cloud/harness/manifest.json`).
 *
 * An entry points either at a media file directly (`file`, with an inline
 * `reference`) or at a clip of one of the generated speech sets
 * (`from: { manifest, clipId }` — the clip's reference text, word times and
 * file come from that set's own manifest, the same data the on-device scores
 * were made with). Generated sets are gitignored, so an entry can be
 * `missing-generate` (a script rebuilds it) or `missing` (no file exists yet).
 *
 * PRIVATE FILES. Everything under `web/tests/media/real/` is the founder's own
 * video. Such a file is private whether or not the manifest says so; the
 * harness refuses it (it is not even probed) unless `--allow-private` is given.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..');
export const defaultManifestFile = resolve(here, '..', 'manifest.json');

const PRIVATE_MARKER = ['tests', 'media', 'real'].join('/');

/** True for any path inside a `tests/media/real/` folder (any checkout, any worktree). */
export function isPrivatePath(file) {
  const normalised = `/${resolve(file).split(sep).join('/').toLowerCase()}/`;
  return normalised.includes(`/${PRIVATE_MARKER}/`);
}

export function loadManifest(file = defaultManifestFile) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(manifest.entries)) throw new Error(`${file}: no "entries" list`);
  const seen = new Set();
  for (const entry of manifest.entries) {
    if (!entry.id || seen.has(entry.id)) throw new Error(`${file}: entry without id or with a repeated id (${entry.id})`);
    seen.add(entry.id);
    if (entry.file && isPrivatePath(resolve(repoRoot, entry.file)) && entry.private !== true) {
      throw new Error(`${file}: "${entry.id}" points into web/tests/media/real/ but is not marked private: true`);
    }
  }
  return manifest;
}

/**
 * Resolves an entry to a file on disk plus its reference.
 * → { id, category, file|null, exists, private, lang, reference|null, words|null, gaps|null,
 *     expectedSpeakers|null, status, note }
 */
export function resolveEntry(entry, root = repoRoot) {
  const out = {
    id: entry.id,
    category: entry.category ?? null,
    title: entry.title ?? entry.id,
    lang: entry.lang ?? null,
    file: null,
    exists: false,
    private: entry.private === true,
    reference: entry.reference ?? null,
    words: null,
    gaps: null,
    expectedSpeakers: entry.expectedSpeakers ?? null,
    approxDurationS: entry.approxDurationS ?? null,
    status: entry.status ?? 'present',
    howToGet: entry.howToGet ?? null,
    note: entry.note ?? null,
  };
  if (entry.status === 'missing') return out;
  if (entry.from) {
    const setFile = resolve(root, entry.from.manifest);
    if (!existsSync(setFile)) return { ...out, status: 'missing-generate' };
    const set = JSON.parse(readFileSync(setFile, 'utf8'));
    const clip = (set.clips ?? []).find((item) => item.id === entry.from.clipId);
    if (!clip) return { ...out, status: 'missing-generate' };
    // `from.dir`: the September set (prepare-speech.mjs) lists bare file names and keeps the files in `clips/`.
    out.file = join(dirname(setFile), entry.from.dir ?? '', clip.file);
    out.reference = typeof clip.reference === 'string' ? clip.reference : (clip.reference?.raw ?? null);
    out.words = clip.words ?? null;
    out.gaps = clip.gaps ?? null;
    out.lang = out.lang ?? clip.lang ?? null;
    out.approxDurationS = clip.durationS ?? out.approxDurationS;
  } else if (entry.file) {
    out.file = isAbsolute(entry.file) ? entry.file : resolve(root, entry.file);
  }
  if (out.file) {
    out.private = out.private || isPrivatePath(out.file);
    out.exists = existsSync(out.file);
    out.status = out.exists ? 'present' : entry.from ? 'missing-generate' : 'missing';
  }
  return out;
}

/** A path given on the command line that is not a manifest id: no reference, so no accuracy score. */
export function adHocEntry(path) {
  const file = resolve(path);
  return {
    id: file.split(sep).pop(),
    category: 'ad-hoc',
    title: file,
    lang: null,
    file,
    exists: existsSync(file),
    private: isPrivatePath(file),
    reference: null,
    words: null,
    gaps: null,
    expectedSpeakers: null,
    approxDurationS: null,
    status: existsSync(file) ? 'present' : 'missing',
    howToGet: null,
    note: 'given on the command line; no reference transcript',
  };
}
