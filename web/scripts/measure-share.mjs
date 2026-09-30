/**
 * What the Web Share API does with big video files (ADR-031): for each size,
 * a disk-backed MP4-typed file is made in the page's private storage (OPFS,
 * sparse, so 1 GB costs no memory), then `navigator.canShare({ files })` and
 * `navigator.share({ files })` are called from a real click. A share that
 * passes the browser's own checks opens the operating system's share sheet;
 * the promise then stays pending until the sheet closes, so an attempt still
 * pending after `--wait` ms is recorded as "sheet opened" and its page is
 * closed. No file leaves the machine: the sheet is never used.
 *
 *   node scripts/measure-share.mjs [--channel=chrome|msedge|chromium] [--headed] [--wait=3000]
 *     [--mobile]   (Android Chrome emulation: user agent, touch, 390 px)
 */
import { createServer } from 'node:http';
import { chromium, devices } from '@playwright/test';

const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const channel = arg('channel', 'chrome');
const waitMs = Number(arg('wait', '3000'));
const headed = process.argv.includes('--headed');
const mobile = process.argv.includes('--mobile');

const MB = 1024 * 1024;
const SIZES = [
  ['1 MiB', 1 * MB],
  ['49 MiB', 49 * MB],
  ['50 MiB', 50 * MB],
  ['50 MiB+1', 50 * MB + 1],
  ['51 MiB', 51 * MB],
  ['100 MiB', 100 * MB],
  ['1 GiB', 1024 * MB],
];

const page = `<!doctype html><html><body><button id="go">share</button><script>
  window.__result = null;
  document.getElementById('go').addEventListener('click', () => {
    const file = window.__file;
    const started = performance.now();
    let promise;
    try { promise = navigator.share({ files: [file] }); } catch (error) { promise = Promise.reject(error); }
    window.__result = { state: 'pending' };
    promise.then(
      () => { window.__result = { state: 'resolved', ms: performance.now() - started }; },
      (error) => { window.__result = { state: 'rejected', name: error && error.name, message: String(error && error.message), ms: performance.now() - started }; },
    );
  });
</script></body></html>`;

const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(page);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: !headed });
const context = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : {});
console.log(`${channel} ${browser.version()}${mobile ? ' (Android emulation)' : ''}${headed ? ' headed' : ' headless'}`);

const rows = [];
try {
  for (const [label, bytes] of SIZES) {
    const tab = await context.newPage();
    await tab.goto(url);
    const setup = await tab.evaluate(async (size) => {
      const hasShare = typeof navigator.share === 'function';
      const hasCanShare = typeof navigator.canShare === 'function';
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('share-probe.mp4', { create: true });
      const writable = await handle.createWritable();
      await writable.truncate(size);
      await writable.close();
      const disk = await handle.getFile();
      const file = new File([disk], 'kesit.mp4', { type: 'video/mp4' });
      window.__file = file;
      let canShare = null;
      try {
        canShare = hasCanShare ? navigator.canShare({ files: [file] }) : null;
      } catch (error) {
        canShare = `throws ${error.name}`;
      }
      return { hasShare, hasCanShare, canShare, size: file.size };
    }, bytes);
    let result = null;
    if (setup.hasShare) {
      await tab.click('#go');
      const deadline = Date.now() + waitMs;
      do {
        result = await tab.evaluate(() => window.__result);
        if (result && result.state !== 'pending') break;
        await tab.waitForTimeout(100);
      } while (Date.now() < deadline);
    }
    rows.push({ label, ...setup, share: result });
    await tab.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('share-probe.mp4').catch(() => undefined);
    }).catch(() => undefined);
    await tab.close();
  }
} finally {
  await browser.close();
  server.close();
}

for (const row of rows) {
  const share = row.share
    ? row.share.state === 'pending'
      ? `still pending after ${waitMs} ms (share sheet opened)`
      : row.share.state === 'resolved'
        ? `resolved in ${Math.round(row.share.ms)} ms`
        : `rejected ${row.share.name} "${row.share.message}" in ${Math.round(row.share.ms)} ms`
    : 'navigator.share missing';
  console.log(`${row.label.padEnd(8)} canShare=${String(row.canShare).padEnd(5)} share: ${share}`);
}
