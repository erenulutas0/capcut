/**
 * Page-side API driven by run-asr.mjs through page.evaluate.
 * `?worker=0` runs the engine on the main thread instead of a Web Worker.
 */
const useWorker = new URL(location.href).searchParams.get('worker') !== '0';
const log = (line) => {
  const el = document.getElementById('log');
  el.textContent += `${new Date().toISOString().slice(11, 19)} ${line}\n`;
};

let worker = null;
let mainEngine = null;
let seq = 0;
const pending = new Map();

function startWorker() {
  if (worker) worker.terminate();
  worker = new Worker('./worker.js', { type: 'module' });
  worker.onmessage = (event) => {
    const { id, ok, result, error, stack } = event.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new Error(stack ? `${error}\n${stack}` : error));
  };
  worker.onerror = (event) => {
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(new Error(`worker error: ${event.message}`));
    }
  };
}

async function call(op, args) {
  if (!useWorker) {
    mainEngine ??= await import('./engine.js');
    return mainEngine[op](args ?? {});
  }
  if (!worker) startWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}

async function gpuInfo() {
  if (!('gpu' in navigator)) return { available: false, reason: 'navigator.gpu missing' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false, reason: 'requestAdapter() returned null' };
    const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    return {
      available: true,
      vendor: info.vendor ?? null,
      architecture: info.architecture ?? null,
      device: info.device ?? null,
      description: info.description ?? null,
      isFallbackAdapter: adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? null,
      shaderF16: adapter.features.has('shader-f16'),
      workerHasGpu: null,
    };
  } catch (error) {
    return { available: false, reason: `${error}` };
  }
}

window.asr = {
  useWorker,
  crossOriginIsolated: self.crossOriginIsolated,
  hardwareConcurrency: navigator.hardwareConcurrency,
  gpuInfo,
  async clearCache() {
    const names = await caches.keys();
    for (const n of names) await caches.delete(n);
    return names;
  },
  restart() {
    if (useWorker) startWorker();
    return true;
  },
  async load(args) {
    log(`load ${args.model} ${args.device} ${JSON.stringify(args.dtype)}`);
    const r = await call('load', args);
    log(`  loaded in ${(r.loadMs / 1000).toFixed(1)} s`);
    return r;
  },
  async transcribe(args) {
    const r = await call('transcribe', args);
    log(`  ${args.url.split('/').pop()} ${r.rtf.toFixed(2)}x: ${r.text.slice(0, 80)}`);
    return r;
  },
  dispose: () => call('dispose'),
  status: () => call('status'),
};
log(`ready (worker=${useWorker}, crossOriginIsolated=${self.crossOriginIsolated})`);
