/**
 * The JavaScript heaps of the editor page and its export worker, read over the
 * Chrome DevTools Protocol while an export runs (ADR-029).
 *
 * Playwright's own CDP sessions only reach pages and frames, not the dedicated
 * worker the export runs in. So the browser is started with a debugging port
 * and this module opens a second, plain CDP connection: it attaches to the
 * editor page (flat sessions) and asks for every worker the page starts to be
 * attached too. For each of them it can then read
 *
 * - `Runtime.getHeapUsage`: the V8 heap in use and its size, plus
 *   `backingStorageSize` (ArrayBuffer contents, which live outside the heap)
 *   and `embedderHeapUsedSize` (Blink objects);
 * - `HeapProfiler.collectGarbage`: a full collection first, so the reading is
 *   what is really retained rather than what the collector has not got to;
 * - `HeapProfiler.takeHeapSnapshot`: the whole heap to a `.heapsnapshot` file
 *   (the format the DevTools memory panel loads), for
 *   `scripts/heap-snapshot-summary.mjs`;
 * - `HeapProfiler.startSampling` / `stopSampling`: allocations by function,
 *   including what was collected again.
 *
 * Measurement only: nothing here is part of the app.
 */
import { createWriteStream } from 'node:fs';

export async function connectToPage(port, urlPart) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const { targetInfos } = await send('Target.getTargets');
  const pageTarget = targetInfos.find((t) => t.type === 'page' && t.url.includes(urlPart));
  if (!pageTarget) throw new Error(`no page target with ${urlPart}`);
  const { sessionId: pageSession } = await send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });

  /** name -> sessionId of each worker the page started (latest wins). */
  const workers = new Map();
  listeners.push((message) => {
    if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'worker') {
      const { sessionId, targetInfo } = message.params;
      workers.set(targetInfo.title || targetInfo.url, sessionId);
      // A worker attached this way waits for nothing, but must be told to run.
      send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
    }
    if (message.method === 'Target.detachedFromTarget') {
      for (const [name, id] of workers) if (id === message.params.sessionId) workers.delete(name);
    }
  });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession);

  const heapUsage = async (sessionId, collect) => {
    if (collect) await send('HeapProfiler.collectGarbage', {}, sessionId);
    return send('Runtime.getHeapUsage', {}, sessionId);
  };

  const snapshot = async (sessionId, file) => {
    const out = createWriteStream(file);
    const onChunk = (message) => {
      if (message.sessionId === sessionId && message.method === 'HeapProfiler.addHeapSnapshotChunk') {
        out.write(message.params.chunk);
      }
    };
    listeners.push(onChunk);
    const started = Date.now();
    try {
      await send('HeapProfiler.enable', {}, sessionId);
      await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false }, sessionId);
    } finally {
      listeners.splice(listeners.indexOf(onChunk), 1);
      await new Promise((resolve) => out.end(resolve));
    }
    return Date.now() - started;
  };

  /**
   * The sampling heap profiler: where the allocations come from, including
   * objects already collected again (what the collector has to clean up,
   * not only what stays).
   */
  const startSampling = async (sessionId) => {
    await send('HeapProfiler.enable', {}, sessionId);
    await send(
      'HeapProfiler.startSampling',
      { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true },
      sessionId,
    );
  };
  const stopSampling = async (sessionId) => (await send('HeapProfiler.stopSampling', {}, sessionId)).profile;

  return {
    pageSession,
    startSampling,
    stopSampling,
    workers,
    /** The session of the worker whose name starts with `prefix`, or null. */
    worker(prefix) {
      for (const [name, id] of workers) if (name.startsWith(prefix)) return id;
      return null;
    },
    heapUsage,
    snapshot,
    close() {
      socket.close();
    },
  };
}
