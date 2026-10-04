/**
 * Puts the speech model files of "Yazıya dök" next to the site (ADR-036).
 *
 * The files are the app's own assets, served from the app's own address
 * (founder decision, 4 Oct 2026: no third-party request at runtime). They are
 * NOT in git: GitHub refuses files over 100 MiB and the repository is not the
 * place for 650 MB of weights. Instead this script, at build time:
 *
 *  1. takes every file in `src/domain/modelManifest.json` from the local
 *     cache (`.models-cache/`, restored by `actions/cache` in CI), from a
 *     local mirror (`--from=<dir>`, Hugging Face layout), from
 *     `node_modules` (the onnxruntime-web runtime), or — only when none of
 *     those has it — downloads it from the pinned Hugging Face revision;
 *  2. checks length and sha256 of every file against the manifest and exits
 *     with an error on any mismatch (a wrong byte never reaches the site);
 *  3. copies the verified files to `<dest>/<group dir>/<path>` and writes
 *     `<dest>/LICENSES.txt` and `<dest>/index.json` (what is there, for the
 *     smoke test).
 *
 *   node scripts/fetch-models.mjs --dest=public/models            # dev / e2e (default: base)
 *   node scripts/fetch-models.mjs --dest=out/capcut-models …      # see ci.yml for the Pages build
 *   node scripts/fetch-models.mjs --models=base,turbo --dest=out/models
 *   node scripts/fetch-models.mjs --check --dest=out/models       # verify only, download nothing
 *
 * Nothing here runs in the browser; the browser side of the same check is
 * `src/adapters/transcript/modelStore.ts`.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const manifest = JSON.parse(readFileSync(join(webDir, 'src', 'domain', 'modelManifest.json'), 'utf8'));
const dest = resolve(webDir, arg('dest', 'public/models'));
const cacheDir = resolve(webDir, arg('cache', '.models-cache'));
const mirror = arg('from', null);
const checkOnly = flag('check');
const models = arg('models', 'base')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
for (const name of models) {
  if (name !== 'base' && name !== 'turbo') {
    console.error(`fetch-models: unknown model "${name}" (base, turbo)`);
    process.exit(1);
  }
}
const groups = ['runtime', 'vad', ...models];

function sha256Of(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function verified(file, expected) {
  if (!existsSync(file)) return false;
  if (statSync(file).size !== expected.bytes) return false;
  return (await sha256Of(file)) === expected.sha256;
}

function sourceUrl(group, file) {
  const { source } = group;
  if (source.kind !== 'huggingface') return null;
  return `https://huggingface.co/${source.repo}/resolve/${source.revision}/${file.path}`;
}

function localCandidates(group, file) {
  const { source } = group;
  if (source.kind === 'npm') return [join(webDir, 'node_modules', source.package, source.path, file.path)];
  if (!mirror) return [];
  return [join(resolve(mirror), source.repo, 'resolve', source.revision, file.path)];
}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`${url} → HTTP ${response.status}`);
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, target);
}

function place(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) rmSync(to);
  try {
    // Same volume: a hard link costs no space (never a junction or a symlink).
    linkSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
}

const LICENSE_NOTE = `Speech model files served with Clip ("Yazıya dök", ADR-036)
=============================================================

These files are application assets. They are downloaded to the browser only
when the user presses "Modeli indir", and they run on the user's device.

Whisper (speech recognition)
  Model: OpenAI Whisper. Code: MIT License, Copyright (c) 2022 OpenAI.
  Weights: openai/whisper-base is published under Apache-2.0,
  openai/whisper-large-v3-turbo under MIT (their Hugging Face model cards).
  The files here are ONNX exports of those weights by the Transformers.js
  team: onnx-community/whisper-base_timestamped and
  onnx-community/whisper-large-v3-turbo_timestamped at the revisions named
  in index.json. Those export repositories declare no licence of their own on
  their cards; they are derived from the weights above and are redistributed
  here under the upstream licences.

Silero VAD (speech detector)
  MIT License, Copyright (c) 2020-present Silero Team.
  ONNX file from onnx-community/silero-vad.

ONNX Runtime Web (the WebAssembly runtime)
  MIT License, Copyright (c) Microsoft Corporation.

MIT License
-----------
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Apache License 2.0
------------------
The full text follows.

`;

let totalBytes = 0;
let downloaded = 0;
const index = { groups: {} };

for (const groupId of groups) {
  const group = manifest.groups[groupId];
  index.groups[groupId] = { dir: group.dir, source: group.source, license: group.license, files: [] };
  for (const file of group.files) {
    const cached = join(cacheDir, group.dir, file.path);
    const target = join(dest, group.dir, file.path);
    if (checkOnly) {
      if (!(await verified(target, file))) {
        console.error(`fetch-models: ${group.dir}/${file.path} is missing or does not match its sha256 in ${dest}`);
        process.exit(1);
      }
      totalBytes += file.bytes;
      index.groups[groupId].files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
      continue;
    }
    if (!(await verified(cached, file))) {
      let found = false;
      for (const candidate of localCandidates(group, file)) {
        if (await verified(candidate, file)) {
          place(candidate, cached);
          found = true;
          break;
        }
      }
      if (!found) {
        const url = sourceUrl(group, file);
        if (!url) {
          console.error(`fetch-models: ${group.dir}/${file.path} is not in node_modules with the pinned sha256 (wrong onnxruntime-web version?)`);
          process.exit(1);
        }
        console.log(`fetch-models: downloading ${url} (${(file.bytes / 1e6).toFixed(1)} MB)`);
        await download(url, cached);
        downloaded += file.bytes;
        if (!(await verified(cached, file))) {
          const got = existsSync(cached) ? await sha256Of(cached) : 'nothing';
          rmSync(cached, { force: true });
          console.error(`fetch-models: sha256 mismatch for ${group.dir}/${file.path}\n  expected ${file.sha256}\n  got      ${got}`);
          process.exit(1);
        }
      }
    }
    place(cached, target);
    if (!(await verified(target, file))) {
      console.error(`fetch-models: ${target} does not match after copying`);
      process.exit(1);
    }
    totalBytes += file.bytes;
    index.groups[groupId].files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
  }
  console.log(`fetch-models: ${groupId} → ${group.dir} (${group.files.length} files)`);
}

if (!checkOnly) {
  const apache = readFileSync(join(webDir, 'node_modules', '@huggingface', 'transformers', 'LICENSE'), 'utf8');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'LICENSES.txt'), LICENSE_NOTE + apache);
  writeFileSync(join(dest, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}
console.log(
  `fetch-models: ${checkOnly ? 'verified' : 'placed'} ${groups.join(', ')} in ${dest} — ${(totalBytes / 1e6).toFixed(1)} MB` +
    (checkOnly ? '' : `, ${(downloaded / 1e6).toFixed(1)} MB downloaded now`),
);
