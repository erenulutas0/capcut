/**
 * ADR-052: "GIF yap" in the app itself — the GIF at the size chosen first (the sharpest under 10 MB),
 * the GIF at "Çok büyük" (960) where the video has it, and the same part as "Video olarak (en net)":
 * file size, frame size and the time from the press to the file, for each clip.
 *
 *   node scripts/gif-eval/video-vs-gif.mjs --clips=<clips.json> --out=<rows.jsonl> [--url=http://127.0.0.1:3195] [--seconds=4] [--keep=<dir>] [--no-xlarge]
 *       [--pick-only] [--cpu=3] [--cores=1] [--limit-ms=600000]
 *
 * `--pick-only`: only the search for the size chosen first (its time and result), nothing made. `--cpu=3`: the
 * page's processor slowed three times through CDP (`Emulation.setCPUThrottlingRate`) — a rough stand-in for a
 * phone. `--limit-ms`: the search's time limit in a test build (`window.__clipGifPickLimitMs`).
 *
 * `clips.json`: [{ "id": "S1", "path": "…" }, …]. Needs a running build at --url. No save dialog (the
 * download link road): each file arrives as a download, is measured (bytes; ffprobe for the video) and
 * deleted (`--keep`: kept in that directory, outside the repository, for a quality comparison). Recordings are named by their ids only; nothing derived from them is kept but the numbers.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const url = args.url ?? 'http://127.0.0.1:3195';
const seconds = Number(args.seconds ?? '4');
const clips = JSON.parse(readFileSync(args.clips, 'utf8'));
const out = args.out;
const keep = args.keep ?? null;

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const json = JSON.parse(r.stdout);
  const video = json.streams.find((s) => s.codec_type === 'video');
  return { codec: video?.codec_name, width: video?.width, height: video?.height, fps: video?.avg_frame_rate, audio: json.streams.some((s) => s.codec_type === 'audio'), durationS: Number(json.format.duration) };
}

// `--cores=1`: the browser (and every process it starts later: Windows hands the affinity down) on one processor
// core — the GIF worker included, which CDP's throttling does not reach (measured: `--cpu=3` changed nothing).
let browser;
let server = null;
if (args.cores) {
  server = await chromium.launchServer({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const mask = (1 << Number(args.cores)) - 1;
  spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${server.process().pid}).ProcessorAffinity = ${mask}`]);
  browser = await chromium.connect(server.wsEndpoint());
} else {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
}
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'tr-TR' });
await context.addInitScript(() => {
  delete window.showSaveFilePicker;
});
if (args['limit-ms']) {
  await context.addInitScript((ms) => {
    window.__clipGifPickLimitMs = ms;
  }, Number(args['limit-ms']));
}

async function save(page, tag) {
  const started = Date.now();
  await page.getByTestId('wizard-download').click();
  const link = page.getByTestId('export-download');
  await link.waitFor({ timeout: 300_000 });
  const ms = Date.now() - started;
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const file = join(tmpdir(), `vvg-${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const bytes = statSync(file).size;
  const facts = file.endsWith('.mp4') ? probe(file) : {};
  if (keep && tag) copyFileSync(file, join(keep, `${tag}${file.endsWith('.mp4') ? '.mp4' : '.gif'}`));
  rmSync(file, { force: true });
  return { bytes, ms, ...facts };
}

for (const clip of clips) {
  const page = await context.newPage();
  try {
    if (args.cpu) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(args.cpu) });
    }
    await page.goto(`${url}/yap/gif/`);
    await page.getByTestId('video-input').setInputFiles(clip.path);
    await page.getByTestId('wizard').and(page.locator('[data-step="choose"]')).waitFor({ timeout: 120_000 });
    if (seconds >= 10) {
      await page.getByTestId('gif-range-end').focus();
      await page.keyboard.press('End');
    }
    const est = page.getByTestId('gif-estimate');
    const sizes = page.getByTestId('gif-size');
    const pickStarted = Date.now();
    if ((await sizes.count()) > 0) await page.locator('[data-testid="gif-size"]:not([data-auto="picking"])').waitFor({ timeout: 300_000 });
    await page.locator('[data-testid="gif-estimate"][data-state="ready"]').waitFor({ timeout: 300_000 });
    const pickMs = Date.now() - pickStarted;
    const why = (await sizes.count()) > 0 ? await sizes.getAttribute('data-auto-why') : 'one_size';
    const chosen = { width: Number(await est.getAttribute('data-width')), height: Number(await est.getAttribute('data-height')), estimated: Number(await est.getAttribute('data-bytes')) };
    if (args['pick-only']) {
      const measured = (await sizes.count()) > 0 ? await sizes.getAttribute('data-measured') : null;
      const row = { id: clip.id, seconds, cpu: Number(args.cpu ?? 1), cores: Number(args.cores ?? 0) || 'all', pickMs, why, chosen, measured };
      console.log(JSON.stringify(row));
      if (out) appendFileSync(out, `${JSON.stringify(row)}
`);
      continue;
    }
    const autoGif = await save(page, `${clip.id}-${seconds}-gif`);
    const row = { id: clip.id, seconds, pickMs, why, autoGif: { ...chosen, ...autoGif } };
    await page.getByTestId('wizard-again-same').click();
    if (!args['no-xlarge'] && (await page.getByTestId('gif-size-xlarge').count()) > 0 && chosen.width !== 960 && chosen.height !== 960) {
      await page.getByTestId('gif-size-xlarge').check();
      await page.locator('[data-testid="gif-estimate"][data-state="ready"]').waitFor({ timeout: 300_000 });
      const xl = { width: Number(await est.getAttribute('data-width')), height: Number(await est.getAttribute('data-height')), estimated: Number(await est.getAttribute('data-bytes')) };
      row.xlargeGif = { ...xl, ...(await save(page)) };
      await page.getByTestId('wizard-again-same').click();
    }
    await page.getByTestId('gif-output-video').check();
    row.video = await save(page, `${clip.id}-${seconds}-video`);
    console.log(JSON.stringify(row));
    if (out) appendFileSync(out, `${JSON.stringify(row)}\n`);
  } catch (error) {
    console.log(JSON.stringify({ id: clip.id, error: String(error).slice(0, 200) }));
  } finally {
    await page.close();
  }
}
await browser.close();
await server?.close();
