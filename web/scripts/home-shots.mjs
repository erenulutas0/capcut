/**
 * Screenshots of the opening screen and the task wizards (ADR-034) at 360,
 * 390 and 1440 px: the opening screen, the search with results, the search
 * with a task that is not built yet, the search with nothing found, every
 * wizard's steps and the saved state. Screenshots of the running app, not
 * mockups; written to docs/ux/2026-10-03-home/shots/.
 *
 * Usage: npm run build && npx next start -p 3100   (in another shell)
 *        node scripts/home-shots.mjs               (SHOT_URL to point elsewhere)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { installSavePicker } from './lib/kesit-flow.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, '..', 'docs', 'ux', '2026-10-03-home', 'shots');
const sample = join(root, 'tests', 'media', 'sample-24s.mp4');
const music = join(root, 'tests', 'media', 'tone-30s.m4a');
const baseURL = process.env.SHOT_URL ?? 'http://127.0.0.1:3100';
/** `--only=kucult,ses`: only those wizards' shots (the rest are left as they are). */
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=').slice(7).split(',').filter(Boolean);

mkdirSync(outDir, { recursive: true });

/** A talk with pauses (generated tone bursts): something for "Boşlukları at" to find. */
function pausesVideo() {
  const dir = join(root, 'tests', 'media', 'silence');
  const file = join(dir, 'shots-pauses.mp4');
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const speech = 'lt(t,1.6)+gte(t,2.6)*lt(t,4.1)+gte(t,4.4)*lt(t,6)+gte(t,6.5)*lt(t,7.8)+gte(t,9.3)*lt(t,12)';
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12',
      '-f', 'lavfi', '-i', `aevalsrc=exprs=0.25*sin(2*PI*440*t)*(${speech}):s=48000:d=12`.replace(/,/g, '\\,'),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
      file,
    ],
    { stdio: 'pipe' },
  );
  return file;
}

const SIZES = [
  { name: '360', width: 360, height: 780, phone: true },
  { name: '390', width: 390, height: 844, phone: true },
  { name: '1440', width: 1440, height: 900, phone: false },
];

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    hasTouch: size.phone,
    isMobile: size.phone,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await installSavePicker(page, { plainNames: true });
  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `${name}-${size.name}.png`), fullPage: true });
    console.log(`${name}-${size.name}.png`);
  };
  const open = async (path) => {
    await page.goto(`${baseURL}${path}`);
    await page.waitForLoadState('networkidle');
  };
  const pick = async (file) => {
    await page.getByTestId('video-input').setInputFiles(file);
  };
  const saved = async () => {
    await page.getByTestId('wizard-download').click();
    await page.getByTestId('download-saved').waitFor({ timeout: 180_000 });
  };

  if (only.length === 0) {
  // ---- the opening screen and the search
  await open('/');
  await shot('01-home');
  await page.getByTestId('finder-input').fill('tiktok için dikey');
  await shot('02-search-results');
  await page.getByTestId('finder-input').fill('sesi kes');
  await shot('03-search-two-results');
  await page.getByTestId('finder-input').fill('altyazı ekle');
  await shot('04-search-unavailable');
  await page.getByTestId('finder-input').fill('pizza siparişi');
  await shot('05-search-none');

  // ---- Kes: pick → the editor, first-run hint showing
  await open('/yap/kes');
  await shot('10-kes-1-pick');
  await pick(sample);
  await page.getByTestId('preview-video').waitFor();
  await shot('11-kes-2-editor');

  // ---- Boşlukları at
  await open('/yap/bosluk');
  await pick(pausesVideo());
  await page.getByTestId('bosluk-summary').waitFor({ timeout: 60_000 });
  await shot('20-bosluk-2-choice');
  await saved();
  await shot('21-bosluk-3-saved');

  // ---- Dikey yap
  await open('/yap/dikey');
  await shot('30-dikey-1-pick');
  await pick(sample);
  await page.getByTestId('dikey-choice').waitFor();
  await shot('31-dikey-2-fill');
  await page.getByTestId('option-contain').check();
  await shot('32-dikey-2-fit');
  await page.getByTestId('wizard-download').click();
  await page.getByTestId('download-running').waitFor({ timeout: 60_000 }).catch(() => undefined);
  await shot('33-dikey-3-running');
  await page.getByTestId('download-saved').waitFor({ timeout: 180_000 });
  await shot('34-dikey-3-saved');

  // ---- Müzik ekle
  await open('/yap/muzik');
  await pick(sample);
  await page.getByTestId('muzik-pick').waitFor();
  await shot('40-muzik-2-no-music');
  await page.getByTestId('audio-input').setInputFiles(music);
  await page.getByTestId('muzik-picked').waitFor();
  await shot('41-muzik-2-choice');
  await saved();
  await shot('42-muzik-3-saved');

  // ---- Her yerde açılsın
  await open('/yap/cevir');
  await pick(sample);
  await page.getByTestId('cevir-info').waitFor();
  await page.getByTestId('cevir-already').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await shot('50-cevir-2-info');
  await saved();
  await shot('51-cevir-3-saved');

  }

  // ---- Küçült (ADR-035): the choice with what each size would give, then the real size
  if (only.length === 0 || only.includes('kucult')) {
    await open('/yap/kucult');
    await pick(sample);
    await page.locator('[data-testid="size-hint-whatsapp"]:not([data-state="pending"])').waitFor({ timeout: 60_000 });
    await shot('60-kucult-2-choice');
    await page.getByTestId('option-whatsapp').check();
    await saved();
    await shot('61-kucult-3-saved');
  }

  // ---- Sesini al (ADR-035)
  if (only.length === 0 || only.includes('ses')) {
    await open('/yap/ses');
    await pick(sample);
    await page.getByTestId('ses-info').waitFor();
    await shot('70-ses-2-info');
    await saved();
    await shot('71-ses-3-saved');
  }

  await context.close();
}

await browser.close();
