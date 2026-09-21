/**
 * Mirrors the exact model files the browser will load into ./models so every
 * run (three browsers × two devices × cold/warm) does not re-download them
 * from Hugging Face. Records repo id, revision, file sizes and sha256 so the
 * report can state exactly what was measured.
 *
 *   node mirror-models.mjs               # tiny, base, small
 *   node mirror-models.mjs --models=turbo
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILES, MODELS, dtypesFor, onnxFilesFor } from './models.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const modelsDir = join(here, 'models');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const wanted = argValue('models', Object.keys(MODELS).filter((k) => !MODELS[k].optional)).toString().split(',');

async function hfFiles(id, revision) {
  const res = await fetch(`https://huggingface.co/api/models/${id}/revision/${revision}?blobs=true`);
  if (!res.ok) throw new Error(`HF API ${id}@${revision} → ${res.status}`);
  const json = await res.json();
  return { gated: json.gated, siblings: new Map(json.siblings.map((s) => [s.rfilename, s])) };
}

async function downloadTo(url, dest) {
  const started = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return { bytes: buf.length, ms: Date.now() - started, sha256: createHash('sha256').update(buf).digest('hex') };
}

const manifestPath = join(modelsDir, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { models: {} };

for (const key of wanted) {
  const model = MODELS[key];
  if (!model) throw new Error(`unknown model ${key}`);
  const { gated, siblings } = await hfFiles(model.id, model.revision);
  if (gated) throw new Error(`${model.id} is gated; the spike must not use gated assets`);
  const files = new Set(CONFIG_FILES);
  for (const device of ['wasm', 'webgpu']) {
    const dtypes = dtypesFor(key, device);
    if (dtypes) for (const f of onnxFilesFor(dtypes)) files.add(f);
  }
  const previous = manifest.models[key];
  const entry =
    previous && previous.id === model.id && previous.revision === model.revision
      ? previous
      : { id: model.id, revision: model.revision, params: model.params, files: {} };
  console.log(`${key}: ${model.id}@${model.revision.slice(0, 8)}`);
  for (const file of files) {
    const sib = siblings.get(file);
    if (!sib) {
      console.log(`  (absent in repo) ${file}`);
      continue;
    }
    const dest = join(modelsDir, model.id, 'resolve', model.revision, file);
    if (existsSync(dest) && statSync(dest).size === sib.size) {
      if (!entry.files[file]) {
        // Already on disk from an earlier run: verify against the LFS oid instead of re-downloading.
        const sha = createHash('sha256').update(readFileSync(dest)).digest('hex');
        if (sib.lfs?.oid && sib.lfs.oid !== sha) throw new Error(`sha256 mismatch on disk for ${file}`);
        entry.files[file] = { bytes: sib.size, sha256: sha, lfsOid: sib.lfs?.oid ?? null, downloadMs: null, mbps: null };
      }
      console.log(`  ok      ${file} (${(sib.size / 1048576).toFixed(1)} MB)`);
      continue;
    }
    const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`;
    const got = await downloadTo(url, dest);
    const expected = sib.lfs?.oid ?? null;
    if (expected && expected !== got.sha256) throw new Error(`sha256 mismatch for ${file}`);
    entry.files[file] = {
      bytes: got.bytes,
      sha256: got.sha256,
      lfsOid: expected,
      downloadMs: got.ms,
      mbps: Number(((got.bytes / 1048576) / (got.ms / 1000)).toFixed(1)),
    };
    console.log(`  fetched ${file} (${(got.bytes / 1048576).toFixed(1)} MB in ${(got.ms / 1000).toFixed(1)} s)`);
  }
  manifest.models[key] = entry;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
console.log(`\nmanifest → ${manifestPath}`);
