/**
 * Prints what the Hugging Face model cards and the installed packages declare
 * as their licence, for the table in the spike report. Read-only.
 *
 *   node licenses.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPOS = [
  'openai/whisper-base',
  'openai/whisper-small',
  'openai/whisper-large-v3-turbo',
  'distil-whisper/distil-small.en',
  'distil-whisper/distil-large-v3.5',
  'UsefulSensors/moonshine',
  'onnx-community/whisper-base_timestamped',
  'onnx-community/whisper-small_timestamped',
  'onnx-community/whisper-large-v3-turbo_timestamped',
  'onnx-community/distil-small.en',
  'onnx-community/distil-large-v3.5-ONNX',
  'onnx-community/moonshine-tiny-ONNX',
  'onnx-community/moonshine-base-ONNX',
  'onnx-community/silero-vad',
];
for (const repo of REPOS) {
  const res = await fetch(`https://huggingface.co/api/models/${repo}`);
  const j = await res.json();
  console.log(`${repo} | licence on card: ${j.cardData?.license ?? '(none declared)'} | base_model: ${JSON.stringify(j.cardData?.base_model ?? null)} | gated: ${j.gated}`);
}
for (const name of ['@huggingface/transformers', 'onnxruntime-web', 'onnxruntime-common', '@playwright/test', 'typescript']) {
  try {
    const j = JSON.parse(readFileSync(join(here, 'node_modules', name, 'package.json'), 'utf8'));
    console.log(`${name} ${j.version} | ${j.license}`);
  } catch {
    console.log(`${name} | not installed`);
  }
}
