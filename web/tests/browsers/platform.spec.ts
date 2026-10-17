import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { hdrFixture } from '../e2e/hdr-media';
import { hevcFixture } from '../e2e/hevc-media';
import { addKesit, closeSheet, installSavePicker, openSettings, openVideo, sourceMs } from '../e2e/kesitFlow';
import { expectStylesApplied } from '../e2e/stylesReady';
import { wizardFixture } from '../e2e/wizard-media';
import { SAMPLE, t } from '../quality/lib/app';
import { probeFile } from '../quality/lib/media';
import { FLOWS, type Flow } from '../quality/lib/walk';
import { walkCard } from './lib/cardWalk';
import { OUTPUTS, crypticIn, engineOf, ensureDir, visibleText, watchProblems, writeCell, type Cell, type Verdict } from './lib/cells';

/**
 * Everything around the cards, per engine and size: what the browser has
 * (measured in the page, never assumed from its name), the opening screen
 * and its search, the offline shell, the editor, the way a file leaves the
 * browser, sharing, the model step of "Yazıya dök", HEVC and HDR sources,
 * and axe.
 *
 * Each test writes one or more rows (docs/quality/browsers-latest.md) and
 * fails only on a "broken" row.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

function cell(testInfo: TestInfo, id: string, verdict: Verdict, summary: string, extra: Partial<Cell> = {}): Cell {
  const made: Cell = { area: 'platform', id, project: testInfo.project.name, verdict, summary, ...extra };
  writeCell(made);
  return made;
}

/** An error's first line, without the terminal's colour codes. */
const plain = (error: unknown): string =>
  (String((error as Error).message).split('\n')[0] ?? 'hata').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 240);

const notBroken = (made: Cell) => expect(made.verdict, `${made.id}: ${made.summary}\n${made.text ?? ''}`).not.toBe('broken');

test('ortam: tarayıcının gerçekte nesi var', async ({ page }, testInfo) => {
  await page.goto('/');
  const facts = await page.evaluate(async () => {
    const g = window as unknown as Record<string, unknown>;
    const nav = navigator as Navigator & { share?: unknown; canShare?: unknown };
    const out: Record<string, unknown> = { userAgent: navigator.userAgent, secureContext: window.isSecureContext };
    for (const name of ['Worker', 'VideoEncoder', 'AudioEncoder', 'VideoDecoder', 'AudioDecoder', 'OffscreenCanvas', 'showSaveFilePicker']) {
      out[name] = typeof g[name] === 'function';
    }
    out.webShare = typeof nav.share === 'function' && typeof nav.canShare === 'function';
    out.serviceWorker = 'serviceWorker' in navigator;
    out.fullscreenEnabled = document.fullscreenEnabled === true;
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('browsers-probe.bin', { create: true });
      out.opfs = true;
      out.opfsCreateWritable = typeof (handle as unknown as { createWritable?: unknown }).createWritable === 'function';
      await root.removeEntry('browsers-probe.bin');
    } catch (error) {
      out.opfs = false;
      out.opfsError = String(error);
    }
    try {
      const estimate = await navigator.storage.estimate();
      out.storageQuotaBytes = estimate.quota ?? null;
      out.storageUsageBytes = estimate.usage ?? null;
    } catch (error) {
      out.storageEstimateError = String(error);
    }
    try {
      out.webgl2 = document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      out.webgl2 = false;
    }
    type Probe = { isConfigSupported: (config: Record<string, unknown>) => Promise<{ supported?: boolean }> };
    const ask = async (api: string, config: Record<string, unknown>): Promise<boolean | null> => {
      const target = g[api] as Probe | undefined;
      if (!target) return null;
      try {
        return (await target.isConfigSupported(config)).supported === true;
      } catch {
        return false;
      }
    };
    out.encodeH264 = await ask('VideoEncoder', { codec: 'avc1.640028', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 });
    out.encodeAac = await ask('AudioEncoder', { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 });
    out.encodeOpus = await ask('AudioEncoder', { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 });
    out.decodeH264 = await ask('VideoDecoder', { codec: 'avc1.640028' });
    out.decodeVp9 = await ask('VideoDecoder', { codec: 'vp09.00.10.08' });
    out.decodeHevc = await ask('VideoDecoder', { codec: 'hvc1.1.6.L93.B0' });
    out.decodeAac = await ask('AudioDecoder', { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2 });
    const video = document.createElement('video');
    out.playsMp4 = video.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"');
    out.playsWebm = video.canPlayType('video/webm; codecs="vp9, opus"');
    return out;
  });
  cell(testInfo, 'ortam', 'works', 'ölçüldü', { facts });
});

test('ana ekran ve arama', async ({ page }, testInfo) => {
  const problems = await watchProblems(page);
  let made: Cell;
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('home.title'));
    await expect(page.getByTestId('task-grid').getByRole('link')).toHaveCount(11);
    // Typed without Turkish letters, as on a keyboard that has none.
    await page.getByRole('combobox').first().fill('kucult');
    await expect(page.getByTestId('result-kucult')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/yap\/kucult\/?$/);
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
    const errors = [...problems.pageErrors, ...problems.unhandledRejections];
    made = cell(
      testInfo,
      'ana-ekran',
      errors.length > 0 ? 'broken' : 'works',
      errors.length > 0 ? `yakalanmamış hata: ${errors[0]}` : 'açıldı; 11 kart; “kucult” yazıp Enter → Küçült sihirbazı',
      { problems },
    );
  } catch (error) {
    made = cell(testInfo, 'ana-ekran', 'broken', plain(error), { problems });
  }
  notBroken(made);
});

/**
 * A door in front of the server that can be shut: the page is opened through
 * it, and "no internet" is the door closing — a real refused connection, the
 * same in every engine. (Playwright's own offline switch is not used: in its
 * WebKit build a navigation then ends in "internal error" before the service
 * worker is asked, which says nothing about the app.)
 */
async function door(target: string): Promise<{ origin: string; shut: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const upstream = new URL(target);
  const server = createServer((request, response) => {
    const forward = httpRequest(
      { host: upstream.hostname, port: upstream.port, path: request.url, method: request.method, headers: request.headers },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    forward.on('error', () => response.destroy());
    request.pipe(forward);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    shut: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

test('çevrimdışı kabuk (service worker)', async ({ page, baseURL }, testInfo) => {
  let made: Cell;
  const front = await door(baseURL as string);
  let open = true;
  try {
    await page.goto(`${front.origin}/`);
    const controlled = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'yok';
      const ready = await Promise.race([
        navigator.serviceWorker.ready.then(() => 'hazır'),
        new Promise<string>((resolve) => setTimeout(() => resolve('zaman aşımı'), 30_000)),
      ]);
      return ready;
    });
    if (controlled !== 'hazır') {
      made = cell(testInfo, 'cevrimdisi', controlled === 'yok' ? 'absent' : 'broken', `service worker: ${controlled}`);
    } else {
      // The worker fills its cache while installing; a reload makes it the page's controller.
      await page.reload();
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 15_000 }).toBe(true);
      await front.shut();
      open = false;
      try {
        await page.reload();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('home.title'));
        await page.goto(`${front.origin}/yap/kes`);
        await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
        await expect(page.getByTestId('pick-video')).toBeEnabled();
        made = cell(testInfo, 'cevrimdisi', 'works', 'sunucuya ulaşılamazken ana ekran ve Kes sihirbazı açıldı, düğmeleri çalışır durumda');
      } catch (error) {
        made = cell(testInfo, 'cevrimdisi', 'broken', `sunucuya ulaşılamazken açılmadı: ${plain(error)}`);
      }
    }
  } catch (error) {
    made = cell(testInfo, 'cevrimdisi', 'broken', plain(error));
  } finally {
    if (open) await front.shut();
  }
  notBroken(made);
});

test('editör: kesit, klavye, tam ekran, kaydetme, paylaşma', async ({ page }, testInfo) => {
  const engine = engineOf(testInfo);
  const touch = testInfo.project.use.hasTouch === true;
  const problems = await watchProblems(page);
  if (engine === 'chromium') await installSavePicker(page);
  const rows: Cell[] = [];

  // --- the editor itself: a video, the playhead by keyboard, a kesit in the list
  try {
    await page.goto('/editor');
    await expect(page.getByTestId('download-all')).toBeVisible();
    await openVideo(page, SAMPLE);
    const playhead = page.getByTestId('timeline-playhead');
    await playhead.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => sourceMs(page), { timeout: 15_000 }).toBe(2000);
    await addKesit(page, '3', '5');
    await expect(page.getByTestId('kesit-card')).toHaveCount(1);
    rows.push(cell(testInfo, 'editor', 'works', 'video açıldı; oynatma çizgisi klavyeyle 2. saniyeye gitti; kesit listeye eklendi'));
  } catch (error) {
    const text = await visibleText(page, '[data-testid="media-error"]');
    rows.push(
      cell(
        testInfo,
        'editor',
        text && !crypticIn(text) ? 'refusal' : 'broken',
        text ? 'editör videoyu açmadı ve nedenini söyledi' : `editör ilerlemedi: ${plain(error)}`,
        { text },
      ),
    );
  }

  // --- fullscreen: the F key (needs a user gesture; a key press is one)
  if (rows[0]?.verdict === 'works') {
    const enabled = await page.evaluate(() => document.fullscreenEnabled === true);
    if (!enabled) {
      const button = await page.getByTestId('fullscreen-toggle').count();
      rows.push(
        cell(
          testInfo,
          'tam-ekran',
          button === 0 ? 'absent' : 'broken',
          button === 0 ? 'tarayıcıda tam ekran yok; düğme de gösterilmiyor' : 'tarayıcıda tam ekran yok ama düğme gösteriliyor',
        ),
      );
    } else {
      try {
        await page.getByTestId('timeline-playhead').focus();
        await page.keyboard.press('f');
        await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null), { timeout: 10_000 }).toBe(true);
        await page.keyboard.press('f');
        await expect.poll(() => page.evaluate(() => document.fullscreenElement === null), { timeout: 10_000 }).toBe(true);
        rows.push(cell(testInfo, 'tam-ekran', 'works', 'F tuşu tam ekrana geçti ve geri döndü'));
      } catch (error) {
        rows.push(cell(testInfo, 'tam-ekran', 'broken', `F tuşu tam ekrana geçmedi: ${plain(error)}`));
        await page.evaluate(() => document.exitFullscreen?.().catch(() => undefined)).catch(() => undefined);
      }
    }

    // --- the way a file leaves the browser, and the share button
    try {
      const kesit = page.getByTestId('kesit-card').first();
      await kesit.getByTestId('kesit-download').click();
      const outcome = kesit.locator(
        '[data-testid="download-saved"], [data-testid="export-download"], [data-testid="export-blocked"], [data-testid="export-failed"]',
      );
      await outcome.first().waitFor({ state: 'visible', timeout: 180_000 });
      // A browser that cannot write sound refuses the kesit in words. The same kesit with its sound turned
      // off needs no audio encoder: that is how a real file reaches the save route in such a browser.
      let soundRefusal = '';
      if ((await kesit.getByTestId('export-blocked').count()) > 0) {
        soundRefusal = await visibleText(page, '[data-testid="export-blocked"]');
        await kesit.getByTestId('download-dismiss').first().click();
        await openSettings(page, 'audio');
        await page.getByTestId('clip-mute').click();
        await closeSheet(page);
        await kesit.getByTestId('kesit-download').click();
        await outcome.first().waitFor({ state: 'visible', timeout: 180_000 });
      }
      const withoutSound = soundRefusal ? ' — SESİ KAPATILMIŞ kesitle; sesli kesit reddedildi (metin aşağıda)' : '';
      const pickerExists = await page.evaluate(() => typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function');
      if ((await kesit.getByTestId('export-download').count()) > 0) {
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), kesit.getByTestId('export-download').click()]);
        const file = join(ensureDir(OUTPUTS), `editor-${testInfo.project.name}-${download.suggestedFilename()}`);
        await download.saveAs(file);
        const info = probeFile(file);
        const good = Math.abs(info.durationS - 2) < 0.15 && info.bytes > 1000;
        rows.push(
          cell(
            testInfo,
            'kaydetme',
            good ? 'works' : 'broken',
            good
              ? `kaydetme penceresi yok → “${t(touch ? 'export.saveDevice' : 'export.save')}” bağlantısı dosyayı indirdi (${download.suggestedFilename()})${withoutSound}`
              : `indirilen dosya beklenen gibi değil: ${info.durationS} sn, ${info.bytes} bayt`,
            { ...(soundRefusal ? { text: soundRefusal, note: 'sesli kesit reddedildi; satır sesi kapatılmış kesitle ölçüldü' } : {}), output: { bytes: info.bytes, durationS: info.durationS, streams: info.streams.map((s) => `${s.type}:${s.codec}`), width: info.video?.width ?? null, height: info.video?.height ?? null } },
          ),
        );
        const share = kesit.getByTestId('download-share');
        const canShare = await page.evaluate(() => typeof (navigator as Navigator & { share?: unknown }).share === 'function');
        const shown = (await share.count()) > 0;
        rows.push(
          cell(
            testInfo,
            'paylas',
            shown && !canShare ? 'broken' : shown ? 'works' : 'absent',
            shown && !canShare
              ? '“Paylaş” gösteriliyor ama tarayıcıda paylaşma yok'
              : shown
                ? '“Paylaş” gösteriliyor (sistem penceresi burada açılıp denenemedi)'
                : canShare
                  ? 'tarayıcı paylaşabiliyor ama bu dosya için “Paylaş” gösterilmedi'
                  : 'tarayıcıda dosya paylaşma yok; “Paylaş” gösterilmiyor, kaydetme yolu duruyor',
          ),
        );
      } else if ((await kesit.getByTestId('download-saved').count()) > 0) {
        rows.push(cell(testInfo, 'kaydetme', 'works', `kaydetme penceresi ${pickerExists ? 'var (testte yerine geçen pencere)' : 'yok'}; dosya seçilen yere yazıldı`));
        rows.push(cell(testInfo, 'paylas', 'not-run', 'kaydetme pencereli yolda “Paylaş” sunulmaz'));
      } else {
        const text = await visibleText(page, '[data-testid="export-blocked"], [data-testid="export-failed"]');
        const honest = text !== '' && !crypticIn(text);
        rows.push(cell(testInfo, 'kaydetme', honest ? 'refusal' : 'broken', honest ? 'dosya oluşturulmadı; nedeni söylendi' : 'dosya oluşturulmadı, açıklama yok', { text }));
        rows.push(cell(testInfo, 'paylas', 'not-run', 'dosya oluşmadığı için paylaşma denenemedi'));
      }
    } catch (error) {
      rows.push(cell(testInfo, 'kaydetme', 'broken', `takıldı: ${plain(error)}`, { text: await visibleText(page, '.dl-status') }));
    }
  } else {
    for (const id of ['tam-ekran', 'kaydetme', 'paylas']) rows.push(cell(testInfo, id, 'not-run', 'editör videoyu açmadığı için denenemedi'));
  }

  // --- the install entry of the ⋯ menu: absent is fine, wrong is not
  try {
    await page.getByTestId('open-more').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const install = (await page.getByTestId('install-app').count()) > 0;
    const ios = (await page.getByTestId('install-ios').count()) > 0;
    rows.push(
      cell(
        testInfo,
        'yukleme',
        install || ios ? 'works' : 'absent',
        install ? '“Uygulama olarak yükle” düğmesi var' : ios ? 'iPhone / iPad için “Ana Ekrana Ekle” adımları gösteriliyor' : 'yükleme önerisi yok (bu tarayıcı sunmuyor); bir şey de vaat edilmiyor',
        { text: ios ? await visibleText(page, '[data-testid="install-ios"]') : undefined },
      ),
    );
  } catch (error) {
    rows.push(cell(testInfo, 'yukleme', 'broken', `⋯ menüsü açılmadı: ${plain(error)}`));
  }

  const errors = [...problems.pageErrors, ...problems.unhandledRejections];
  if (errors.length > 0) rows.push(cell(testInfo, 'editor-hatalar', 'broken', `yakalanmamış hata: ${errors.join(' | ').slice(0, 400)}`, { problems }));
  for (const row of rows) notBroken(row);
});

test('Yazıya dök: model adımı', async ({ page }, testInfo) => {
  const problems = await watchProblems(page);
  let made: Cell;
  try {
    await page.goto('/yap/yazi');
    await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15_000 }), page.getByTestId('pick-video').click()]);
    await chooser.setFiles(SAMPLE);
    await page.waitForSelector('[data-testid="model-download"], [data-testid="transcribe-start"], [data-testid="media-error"]', { timeout: 60_000 });
    if ((await page.getByTestId('model-download').count()) === 0) {
      const text = await visibleText(page, '[data-testid="media-error"]');
      made = cell(testInfo, 'yazi-model', text && !crypticIn(text) ? 'refusal' : 'broken', text ? 'model adımına gelmeden durdu ve nedenini söyledi' : 'model adımı gelmedi', { text });
    } else {
      const label = ((await page.getByTestId('model-download').textContent()) ?? '').trim();
      // The model files are not in this checkout (public/models): pressing must end in words, not in a spinner.
      await page.getByTestId('model-download').click();
      const ended = page.locator('[data-testid="transcribe-start"], [data-testid="model-failed"]');
      let text = '';
      try {
        await ended.first().waitFor({ state: 'visible', timeout: 90_000 });
        text = await visibleText(page, '[data-testid="model-failed"]');
      } catch {
        text = '';
      }
      const started = (await page.getByTestId('transcribe-start').count()) > 0;
      made = started
        ? cell(testInfo, 'yazi-model', 'works', `“${label}” modeli indirdi; yazıya dökme başlatılabilir`)
        : text && !crypticIn(text)
          ? cell(testInfo, 'yazi-model', 'refusal', `“${label}” düğmesine basıldı; model dosyaları bu makinede yok, uygulama bunu söyledi (yazıya dökmenin kendisi KOŞULMADI)`, { text })
          : cell(testInfo, 'yazi-model', 'broken', `“${label}” düğmesinden sonra 90 sn içinde ne model ne mesaj`, { text: await visibleText(page, 'main') });
    }
  } catch (error) {
    made = cell(testInfo, 'yazi-model', 'broken', plain(error));
  }
  const errors = [...problems.pageErrors, ...problems.unhandledRejections];
  if (made.verdict !== 'broken' && errors.length > 0) made = cell(testInfo, 'yazi-model', 'broken', `yakalanmamış hata: ${errors[0]}`, { problems, text: made.text });
  notBroken(made);
});

// HEVC and HDR sources through "Her yerde açılsın": the card whose whole job is a file other devices cannot open.
const cevir = FLOWS.find((flow) => flow.id === 'cevir') as Flow;
const SOURCES: Array<{ id: string; note: string; source: () => string }> = [
  { id: 'kaynak-hevc', note: 'HEVC (H.265) kaynak', source: hevcFixture },
  { id: 'kaynak-hdr', note: 'HDR (HLG / PQ) kaynak', source: hdrFixture },
];

for (const item of SOURCES) {
  test(`${item.note} → Her yerde açılsın`, async ({ page }, testInfo) => {
    let file: string;
    try {
      file = item.source();
    } catch (error) {
      cell(testInfo, item.id, 'not-run', `deneme dosyası üretilemedi (ffmpeg): ${plain(error)}`);
      return;
    }
    const flow: Flow = {
      ...cevir,
      sourceNote: item.note,
      source: () => file,
      // Only what holds for any source: an MP4 with H.264 picture came out.
      verify: (out) => [
        { name: 'MP4', ok: /mp4/.test(out.format), value: out.format },
        { name: 'görüntü H.264', ok: out.video?.codec === 'h264', value: out.video?.codec ?? 'yok' },
      ],
    };
    const walked = await walkCard(page, testInfo, flow);
    const made = cell(testInfo, item.id, walked.verdict, walked.summary, { ...walked, area: 'platform', id: item.id });
    notBroken(made);
  });
}

/**
 * "Sesi kapat" with a source that cannot be copied (VP9 in WebM): the file
 * has no sound, so no audio encoder is needed, but every picture goes through
 * the browser's own H.264 encoder. In Firefox — which has no AAC encoder —
 * this is the one road on which its encoder really makes a file (the card
 * walk's MP4 source is copied, not encoded).
 */
test('Sesi kapat, kopyalanamayan kaynak (WebM): tarayıcının kendi H.264 kodlayıcısı', async ({ page }, testInfo) => {
  const sustur = FLOWS.find((flow) => flow.id === 'sustur') as Flow;
  const flow: Flow = {
    ...sustur,
    sourceNote: 'tarayici-kaydi.webm (VP9 + Opus, 640 × 360, 2 sn)',
    source: () => wizardFixture('webm'),
    verify: (out) => [
      { name: 'MP4', ok: /mp4/.test(out.format), value: out.format },
      { name: 'yalnızca H.264 görüntü, ses yok', ok: out.streams.length === 1 && out.video?.codec === 'h264', value: out.streams.map((s) => `${s.type}:${s.codec}`).join(' + ') },
      { name: 'süre ≈ 2 sn', ok: Math.abs(out.durationS - 2) <= 0.15, value: `${out.durationS} sn` },
      { name: 'boyut 640 × 360', ok: out.video?.width === 640 && out.video?.height === 360, value: `${out.video?.width} × ${out.video?.height}` },
    ],
  };
  const walked = await walkCard(page, testInfo, flow);
  const made = cell(testInfo, 'sessiz-kodlama', walked.verdict, walked.summary, { ...walked, area: 'platform', id: 'sessiz-kodlama' });
  notBroken(made);
});

async function axe(page: Page, label: string, testInfo: TestInfo): Promise<string[]> {
  await expectStylesApplied(page, label, testInfo);
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return result.violations.map((violation) => `${violation.id} (${violation.nodes.length})`);
}

test('axe: ana ekran ve bir sihirbaz', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const home = await axe(page, 'ana ekran', testInfo);
  await page.goto('/yap/dikey');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  const wizard = await axe(page, 'dikey sihirbazı', testInfo);
  const all = [...home.map((rule) => `ana ekran: ${rule}`), ...wizard.map((rule) => `sihirbaz: ${rule}`)];
  const made = cell(testInfo, 'axe', all.length === 0 ? 'works' : 'broken', all.length === 0 ? 'ana ekran ve Dikey yap sihirbazı: 0 bulgu' : all.join('; '));
  notBroken(made);
});
