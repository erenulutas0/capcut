import * as engine from './engine.js';

self.onmessage = async (event) => {
  const { id, op, args } = event.data;
  try {
    const result = await engine[op](args ?? {});
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: `${error?.message ?? error}`, stack: error?.stack ?? null });
  }
};
