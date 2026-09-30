/**
 * Reads what a real Android Chrome (over adb + CDP) offers the editor:
 * encoders, storage, save dialog, file sharing. Read-only: opens no dialog,
 * writes nothing but a tiny OPFS probe file it deletes again.
 *
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   node scripts/android/cdp-probe.mjs [--url=https://erenulutas0.github.io/capcut/editor/]
 */
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const url = arg('url', 'https://erenulutas0.github.io/capcut/editor/');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = await context.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.getByTestId('download-all').waitFor({ timeout: 60_000 });

const report = await page.evaluate(async () => {
  const videoConfigs = [
    { codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 },
    { codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 8_000_000, framerate: 30 },
    { codec: 'avc1.64001f', width: 1280, height: 720, bitrate: 4_000_000, framerate: 30 },
  ];
  const video = [];
  for (const config of videoConfigs) {
    for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software']) {
      const result = await VideoEncoder.isConfigSupported({ ...config, hardwareAcceleration }).catch((e) => ({
        supported: false,
        error: String(e),
      }));
      video.push({ config: `${config.width}x${config.height}`, hardwareAcceleration, supported: result.supported });
    }
  }
  const audio = await AudioEncoder.isConfigSupported({
    codec: 'mp4a.40.2',
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 128000,
  }).catch((e) => ({ supported: false, error: String(e) }));
  const hevcDecode = await VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L120.90', codedWidth: 1920, codedHeight: 1080 })
    .then((r) => r.supported)
    .catch(() => false);
  let opfs = false;
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('__probe', { create: true });
    await root.removeEntry('__probe');
    opfs = Boolean(handle);
  } catch {
    opfs = false;
  }
  const estimate = await navigator.storage.estimate().catch(() => null);
  const file = new File([new Uint8Array(16)], 'probe.mp4', { type: 'video/mp4' });
  return {
    userAgent: navigator.userAgent,
    deviceMemory: navigator.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    screen: `${screen.width}x${screen.height} @${devicePixelRatio}`,
    viewport: `${innerWidth}x${innerHeight}`,
    webcodecs: typeof VideoEncoder === 'function',
    video,
    aacEncode: audio.supported,
    hevcDecode,
    opfs,
    storageEstimateGiB: estimate ? Number(((estimate.quota - estimate.usage) / 2 ** 30).toFixed(2)) : null,
    showSaveFilePicker: typeof window.showSaveFilePicker === 'function',
    canShareFiles: typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : false,
    fullscreenEnabled: document.fullscreenEnabled,
    offscreenCanvas: typeof OffscreenCanvas === 'function',
  };
});
console.log(JSON.stringify(report, null, 2));
await page.close();
// Only disconnect: never close the phone's own browser.
process.exit(0);
