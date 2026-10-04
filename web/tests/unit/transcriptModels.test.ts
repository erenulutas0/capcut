import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifestJson from '@/domain/modelManifest.json';
import { Sha256, sha256Hex } from '@/domain/sha256';
import {
  MODEL_MANIFEST,
  MODEL_PART_BYTES,
  MODEL_RUNTIME,
  checkFile,
  downloadBytes,
  filesFor,
  groupsFor,
  isModelManifest,
  missingBytes,
  partsOf,
} from '@/domain/transcriptModels';

const nodeSha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('streaming SHA-256', () => {
  it('matches the known vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches Node on every length around the block and padding edges', () => {
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4097]) {
      const data = new Uint8Array(randomBytes(length));
      expect(sha256Hex(data), `length ${length}`).toBe(nodeSha(data));
    }
  });

  it('gives the same digest however the bytes are split', () => {
    const data = new Uint8Array(randomBytes(200_003));
    const expected = nodeSha(data);
    for (const sizes of [[1], [63], [64], [65], [7, 129, 4096], [100_000, 1, 99_000]]) {
      const hash = new Sha256();
      let at = 0;
      for (let turn = 0; at < data.length; turn += 1) {
        const take = sizes[turn % sizes.length] as number;
        hash.update(data.subarray(at, at + take));
        at += take;
      }
      expect(hash.digestHex(), sizes.join(',')).toBe(expected);
    }
  });

  it('refuses bytes after the digest was taken', () => {
    const hash = new Sha256().update(new Uint8Array([1, 2, 3]));
    hash.digestHex();
    expect(() => hash.update(new Uint8Array([4]))).toThrow();
  });
});

describe('the pinned model list', () => {
  it('is a usable manifest with exact pins', () => {
    expect(isModelManifest(MODEL_MANIFEST)).toBe(true);
    for (const group of Object.values(manifestJson.groups)) {
      for (const file of group.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
      }
    }
    // Hugging Face sources are pinned to a full commit, never a branch name.
    for (const id of ['vad', 'base', 'turbo'] as const) {
      const source = manifestJson.groups[id].source as { revision?: string };
      expect(source.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(manifestJson.groups[id].dir.endsWith(source.revision!.slice(0, 8))).toBe(true);
    }
  });

  it('a model needs the runtime, the speech detector and its own files', () => {
    expect(groupsFor('base')).toEqual(['runtime', 'vad', 'base']);
    const base = filesFor('base');
    expect(base.some((file) => file.key.endsWith('ort-wasm-simd-threaded.asyncify.wasm'))).toBe(true);
    expect(base.some((file) => file.key.endsWith('silero-vad-e71cae96/onnx/model.onnx'))).toBe(true);
    expect(base.some((file) => file.key.endsWith('onnx/encoder_model_quantized.onnx'))).toBe(true);
    expect(base.some((file) => file.key.includes('turbo'))).toBe(false);
    expect(filesFor('turbo').some((file) => file.key.endsWith('onnx/encoder_model_q4f16.onnx'))).toBe(true);
  });

  it('says what the download really costs', () => {
    // What "Modeli indir (≈… MB)" shows: model + speech detector + runtime.
    expect(downloadBytes('base')).toBe(79_741_027 + 2_243_022 + 26_861_777);
    expect(downloadBytes('turbo')).toBe(566_460_117 + 2_243_022 + 26_861_777);
    // The second model reuses the runtime and the detector already stored.
    const stored = new Set(filesFor('base').map((file) => file.key));
    expect(missingBytes('turbo', stored)).toBe(566_460_117);
    expect(missingBytes('base', stored)).toBe(0);
    expect(missingBytes('base', new Set())).toBe(downloadBytes('base'));
  });

  it('the runtime pin is the onnxruntime-web file in node_modules', () => {
    const [file] = manifestJson.groups.runtime.files;
    const path = join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist', file!.path);
    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect(bytes.length).toBe(file!.bytes);
    expect(nodeSha(bytes)).toBe(file!.sha256);
    const version = (JSON.parse(readFileSync(join(process.cwd(), 'node_modules', 'onnxruntime-web', 'package.json'), 'utf8')) as { version: string }).version;
    expect(manifestJson.groups.runtime.dir).toBe(`runtime-ort-${version}`);
  });

  it('runs each model the way the spike measured it', () => {
    expect(MODEL_RUNTIME.base).toMatchObject({ device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
    expect(MODEL_RUNTIME.turbo).toMatchObject({ device: 'webgpu', dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' } });
  });
});

describe('parts and the acceptance rule', () => {
  it('cuts a file into parts that cover it exactly once', () => {
    for (const bytes of [0, 1, MODEL_PART_BYTES - 1, MODEL_PART_BYTES, MODEL_PART_BYTES + 1, 370_035_242]) {
      const parts = partsOf(bytes);
      expect(parts[0]!.start).toBe(0);
      expect(parts[parts.length - 1]!.end).toBe(bytes);
      for (let i = 1; i < parts.length; i += 1) expect(parts[i]!.start).toBe(parts[i - 1]!.end);
      expect(parts.every((part) => part.end - part.start <= MODEL_PART_BYTES)).toBe(true);
      expect(parts.map((part) => part.index)).toEqual(parts.map((_, index) => index));
    }
    expect(partsOf(370_035_242)).toHaveLength(12);
  });

  it('accepts only the exact length and the exact sha256', () => {
    const data = new Uint8Array(randomBytes(1000));
    const file = { path: 'x.onnx', bytes: data.length, sha256: nodeSha(data) };
    expect(checkFile(file, { bytes: 1000, sha256: sha256Hex(data) })).toEqual({ ok: true });
    expect(checkFile(file, { bytes: 999, sha256: file.sha256 })).toEqual({ ok: false, reason: 'size_mismatch' });
    const flipped = Uint8Array.from(data);
    flipped[500] = (flipped[500] as number) ^ 1;
    expect(checkFile(file, { bytes: 1000, sha256: sha256Hex(flipped) })).toEqual({ ok: false, reason: 'hash_mismatch' });
  });

  it('refuses a manifest with a path that climbs out or a pin that is not a sha256', () => {
    const good = JSON.parse(JSON.stringify(MODEL_MANIFEST)) as typeof MODEL_MANIFEST;
    expect(isModelManifest(good)).toBe(true);
    const climbing = JSON.parse(JSON.stringify(good));
    climbing.groups.base.files[0].path = '../secret';
    expect(isModelManifest(climbing)).toBe(false);
    const unpinned = JSON.parse(JSON.stringify(good));
    unpinned.groups.vad.files[0].sha256 = 'latest';
    expect(isModelManifest(unpinned)).toBe(false);
    const odd = JSON.parse(JSON.stringify(good));
    odd.groups.base.dir = 'a/b';
    expect(isModelManifest(odd)).toBe(false);
    expect(isModelManifest(null)).toBe(false);
    expect(isModelManifest({ storeVersion: 1, groups: {} })).toBe(false);
  });
});
