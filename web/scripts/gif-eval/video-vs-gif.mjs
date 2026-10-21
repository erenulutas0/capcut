/**
 * ADR-052: "GIF yap" in the app itself — the GIF at the size chosen first (the sharpest under 10 MB),
 * the GIF at "Çok büyük" (960) where the video has it, and the same part as "Video olarak (en net)":
 * file size, frame size and the time from the press to the file, for each clip.
 *
 *   node scripts/gif-eval/video-vs-gif.mjs --clips=<clips.json> --out=<rows.jsonl> [--url=http://127.0.0.1:3195] [--seconds=4]
 *
 * `clips.json`: [{ "id": "S1", "path": "…" }, …]. Needs a running build at --url. No save dialog (the
 * download link road): each file arrives as a download, is measured (bytes; ffprobe for the video) and
 * deleted. Recordings are named by their ids only; nothing derived from them is kept but the numbers.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const url = args.url ?? 'http://127.0.0.1:3195';
const seconds = Number(args.seconds ?? '4');
const clips = JSON.parse(readFileSync(args.clips, 'utf8'));
const out = args.out;

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const json = JSON.parse(r.stdout);
  const video = json.streams.find((s) => s.codec_type === 'video');
  return { codec: video?.codec_name, width: video?.width, height: video?.height, fps: video?.avg_frame_rate, audio: json.streams.some((s) => s.codec_type === 'audio'), durationS: Number(json.format.duration) };
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'tr-TR' });
await context.addInitScript(() => {
  delete window.showSaveFilePicker;
});

async function save(page) {
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
  rmSync(file, { force: true });
  return { bytes, ms, ...facts };
}

for (const clip of clips) {
  const page = await context.newPage();
  try {
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
    const autoGif = await save(page);
    const row = { id: clip.id, seconds, pickMs, why, autoGif: { ...chosen, ...autoGif } };
    await page.getByTestId('wizard-again-same').click();
    if ((await page.getByTestId('gif-size-xlarge').count()) > 0 && chosen.width !== 960 && chosen.height !== 960) {
      await page.getByTestId('gif-size-xlarge').check();
      await page.locator('[data-testid="gif-estimate"][data-state="ready"]').waitFor({ timeout: 300_000 });
      const xl = { width: Number(await est.getAttribute('data-width')), height: Number(await est.getAttribute('data-height')), estimated: Number(await est.getAttribute('data-bytes')) };
      row.xlargeGif = { ...xl, ...(await save(page)) };
      await page.getByTestId('wizard-again-same').click();
    }
    await page.getByTestId('gif-output-video').check();
    row.video = await save(page);
    console.log(JSON.stringify(row));
    if (out) appendFileSync(out, `${JSON.stringify(row)}\n`);
  } catch (error) {
    console.log(JSON.stringify({ id: clip.id, error: String(error).slice(0, 200) }));
  } finally {
    await page.close();
  }
}
await browser.close();
