/**
 * Which open-weight Whisper exports the spike measures, pinned to exact
 * Hugging Face revisions so the numbers in the report can be reproduced.
 *
 * Every repo below is ungated and Apache-2.0 (openai/whisper weights, exported
 * to ONNX by the Transformers.js team). Nothing here is user data: the model
 * files are application assets.
 *
 * The primary candidates are the `_timestamped` exports: their decoder emits
 * cross-attention weights, which Transformers.js needs for word-level
 * timestamps (`return_timestamps: 'word'`). The plain exports cannot give word
 * times at all (verified: "Model outputs must contain cross attentions") and
 * are kept only as a speed/accuracy reference.
 */
export const MODELS = {
  tiny: {
    id: 'onnx-community/whisper-tiny_timestamped',
    revision: '517244293732ee2d58139af5814231b7e6830a0d',
    params: '39M',
  },
  base: {
    id: 'onnx-community/whisper-base_timestamped',
    revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
    params: '74M',
  },
  small: {
    id: 'onnx-community/whisper-small_timestamped',
    revision: '65caa70f294b46e1c33ff820aae6b16d048ab818',
    params: '244M',
  },
  // Plain exports (no cross attentions → no word timestamps). Reference only.
  'tiny-plain': {
    id: 'onnx-community/whisper-tiny',
    revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
    params: '39M',
    optional: true,
  },
  'base-plain': {
    id: 'onnx-community/whisper-base',
    revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
    params: '74M',
    optional: true,
  },
  'small-plain': {
    id: 'onnx-community/whisper-small',
    revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    params: '244M',
    optional: true,
  },
  // Out of the ADR-017 size range (~40–250 MB); only mirrored/run when asked
  // for explicitly (`--models=turbo`). fp32 encoder alone is 2.4 GB, so the
  // only plausible browser variant is q4f16 (353 MB encoder + 185 MB decoder).
  turbo: {
    id: 'onnx-community/whisper-large-v3-turbo_timestamped',
    revision: 'b3f77bf9a8c4d5ea3415827033d1ffea7955fd9a',
    params: '809M',
    optional: true,
    dtypes: {
      webgpu: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
      wasm: null, // 1 GB of q8 weights on WASM is not a shippable configuration
    },
  },
};

/**
 * Per-device quantisation. `q8` on WASM is the Transformers.js default; on
 * WebGPU the fp32 encoder + q4 decoder pairing is what the official
 * whisper-webgpu example ships (integer-quantised ops do not run on WebGPU).
 * File suffixes follow Transformers.js: '' (fp32), '_quantized' (q8), '_q4'.
 */
export const DEVICE_DTYPES = {
  wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
};

export const DTYPE_SUFFIX = {
  fp32: '',
  fp16: '_fp16',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  int8: '_int8',
};

/** Non-weight files Transformers.js reads for a Whisper pipeline. */
export const CONFIG_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'normalizer.json',
  'quantize_config.json',
];

export function dtypesFor(modelKey, device) {
  const model = MODELS[modelKey];
  if (model.dtypes && device in model.dtypes) return model.dtypes[device];
  return DEVICE_DTYPES[device] ?? null;
}

export function onnxFilesFor(dtypes) {
  return Object.entries(dtypes).map(([name, dtype]) => `onnx/${name}${DTYPE_SUFFIX[dtype]}.onnx`);
}
