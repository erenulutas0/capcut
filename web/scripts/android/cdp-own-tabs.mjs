/**
 * A DevTools endpoint that shows the scripts only the tabs they open.
 *
 * Playwright's `connectOverCDP` attaches to every tab of the phone's Chrome
 * and waits until each one has loaded. Chrome on Android restores the tabs
 * of a fresh start lazily: a tab nobody has looked at never loads, and the
 * connection then times out (seen on 2 October 2026, right after Chrome
 * started). It also means the script sees the founder's own tabs, which it
 * has no business with.
 *
 * This proxy sits between Playwright and the phone (`adb forward`). Targets
 * that existed when the script connected are never shown: their attach
 * events are dropped and Chrome is told to detach (and to let a tab paused
 * for the debugger run on). Tabs the script creates (`Target.createTarget`),
 * the windows they open, and the workers and frames inside them pass through.
 *
 *   const endpoint = await ownTabsEndpoint('http://127.0.0.1:9222');
 *   const browser = await chromium.connectOverCDP(endpoint);
 *
 * `show`: target ids of earlier tabs the script itself opened (a tab left
 * behind by a dropped connection, to be cleaned up).
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ws: WebSocket, wsServer: WebSocketServer } = require('playwright-core/lib/utilsBundle');

/** Starts the proxy on a free local port; resolves to its http endpoint. */
export async function ownTabsEndpoint(upstream, { show = [] } = {}) {
  const version = await (await fetch(`${upstream}/json/version`)).json();
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/json/version')) {
      const { port } = server.address();
      const local = version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${port}`);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ...version, webSocketDebuggerUrl: local }));
      return;
    }
    // No tab list: the scripts do not need one.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (client) => bridge(client, version.webSocketDebuggerUrl, show));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  // Never keeps the script alive by itself.
  server.unref();
  return `http://127.0.0.1:${server.address().port}`;
}

function bridge(client, upstreamUrl, show) {
  const upstream = new WebSocket(upstreamUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  const queued = [];
  /** Targets present before the script did anything: never shown. */
  const foreign = new Set();
  /** Targets the script created (or that they opened). */
  const own = new Set(show);
  /** Sessions the script may see: its tabs' and their children's. */
  const allowedSessions = new Set();
  const hiddenSessions = new Set();
  let creating = 0;
  let ready = false;
  let nextInternalId = -1;
  const internal = new Map();

  const toUpstream = (message) => upstream.send(JSON.stringify(message));
  const ask = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const id = nextInternalId;
      nextInternalId -= 1;
      internal.set(id, resolve);
      toUpstream({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    });

  const hide = (sessionId) => {
    hiddenSessions.add(sessionId);
    void ask('Runtime.runIfWaitingForDebugger', {}, sessionId);
    void ask('Target.detachFromTarget', { sessionId });
  };

  const isOwnTarget = (info) => own.has(info.targetId) || (info.openerId !== undefined && own.has(info.openerId));

  upstream.on('open', async () => {
    const { result } = await ask('Target.getTargets');
    for (const info of result?.targetInfos ?? []) if (!own.has(info.targetId)) foreign.add(info.targetId);
    ready = true;
    for (const message of queued.splice(0)) toUpstream(message);
  });

  upstream.on('message', (data) => {
    const message = JSON.parse(String(data));
    if (message.id !== undefined && internal.has(message.id)) {
      internal.get(message.id)(message);
      internal.delete(message.id);
      return;
    }
    // Anything from a hidden tab's session: dropped.
    if (message.sessionId && !allowedSessions.has(message.sessionId)) return;
    if (message.method === 'Target.attachedToTarget') {
      const info = message.params.targetInfo;
      const childOfOwn = message.sessionId !== undefined; // attached under an allowed session
      const mine =
        info.type === 'browser' ||
        childOfOwn ||
        isOwnTarget(info) ||
        (!foreign.has(info.targetId) && creating > 0 && info.type === 'page');
      if (!mine) {
        hide(message.params.sessionId);
        return;
      }
      if (info.type === 'page' || info.type === 'tab') own.add(info.targetId);
      allowedSessions.add(message.params.sessionId);
    }
    if (message.method === 'Target.detachedFromTarget' && hiddenSessions.has(message.params.sessionId)) return;
    if (/^Target\.target(Created|InfoChanged|Destroyed)$/.test(message.method ?? '')) {
      const targetId = message.params.targetInfo?.targetId ?? message.params.targetId;
      if (!own.has(targetId) && !(message.params.targetInfo && isOwnTarget(message.params.targetInfo))) return;
    }
    if (message.result?.targetInfos) {
      message.result.targetInfos = message.result.targetInfos.filter((info) => own.has(info.targetId));
    }
    if (message.result?.targetId && message.id !== undefined && pendingCreates.has(message.id)) {
      pendingCreates.delete(message.id);
      creating -= 1;
      own.add(message.result.targetId);
    }
    client.send(JSON.stringify(message));
  });

  const pendingCreates = new Set();
  client.on('message', (data) => {
    const message = JSON.parse(String(data));
    if (message.method === 'Target.createTarget' && !message.sessionId) {
      pendingCreates.add(message.id);
      creating += 1;
    }
    if (ready) toUpstream(message);
    else queued.push(message);
  });

  const close = () => {
    if (client.readyState === WebSocket.OPEN) client.close();
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };
  client.on('close', close);
  upstream.on('close', close);
  upstream.on('error', close);
  client.on('error', close);
}
