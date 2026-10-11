import { expect, test } from '@playwright/test';

import { STUB_LINES, STUB_SCRIPT, installTranscriptTest, longVideo, serveModels, testModels } from '../e2e/transcriptKit';
import {
  FAKE_ORIGIN,
  SCRIPT_LINES,
  SCRIPT_WORDS,
  cloudHook,
  ct,
  enterInvite,
  fill,
  lineTexts,
  openChoice,
  openReady,
  probeUpload,
  startFake,
  storedInvite,
  watchNetwork,
  type FakeWorker,
} from './cloudKit';
import { readFileSync } from 'node:fs';

/**
 * "Yazıya dök" → "İnternette", from the choice screen to the transcript,
 * against the LOCAL FAKE of our proxy (cloudKit.ts). What this proves is the
 * flow, what leaves the browser and what is said on screen — not how well any
 * speech is written: the fake hears nothing.
 */

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

const sent = () => fake.requests.filter((request) => request.method !== 'OPTIONS').map((request) => `${request.method} ${request.path.replace(/[0-9a-f-]{36}/, ':id')}`);

test('the whole way: invite code, send, the transcript with speakers, deleted at the provider', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const network = watchNetwork(context, baseURL);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 2, languageCode: 'tr' });

  await openChoice(page);
  await expect(page.getByTestId('wizard-title')).toHaveText(ct('cloud.choice.title'));
  // No saved code: the screen has asked nobody anything.
  expect(network.external()).toEqual([]);
  expect(fake.requests).toEqual([]);

  await enterInvite(page, invite);
  await expect(page.getByTestId('route-minutes')).toHaveText(fill(ct('cloud.online.minutes'), { n: 1, x: 1, y: 59 }));
  expect(await storedInvite(page)).toBe(invite);
  // Asking for the minutes is the only thing that has happened: no upload, no job.
  expect(sent()).toEqual(['GET /v1/quota']);
  expect(fake.uploads).toHaveLength(0);

  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });

  // The transcript: the app's own lines, said to be written on the internet, each turn with its voice.
  expect(await lineTexts(page)).toEqual(SCRIPT_LINES);
  await expect(page.getByTestId('transcript-machine-note')).toContainText(ct('cloud.machine'));
  await expect(page.getByTestId('yazi-cloud-summary')).toContainText(`${fill(ct('cloud.done'), { lines: 4 })} ${fill(ct('cloud.done.speakers'), { n: 2 })}`);
  // Minutes left come from the proxy, after the job.
  await expect(page.getByTestId('yazi-cloud-summary')).toContainText(fill(ct('cloud.done.minutes'), { y: 59 }));
  await expect(page.getByTestId('transcript-speaker')).toHaveText(['1. kişi', '2. kişi', '1. kişi', '2. kişi']);
  await expect(page.getByTestId('wizard-footer')).toHaveText(ct('cloud.footer.sent'));
  await expect(page.getByTestId('wizard-title')).not.toHaveText(ct('cloud.choice.title'));

  // What left the browser: one sound-only file — to the fake and to nobody else — and the calls the contract names.
  expect(network.strangers()).toEqual([]);
  expect(sent()).toEqual(expect.arrayContaining(['POST /v1/jobs', 'GET /v1/jobs/:id', 'GET /v1/jobs/:id/result', 'DELETE /v1/jobs/:id']));
  expect(sent().filter((entry) => entry === 'POST /v1/jobs')).toHaveLength(1);
  // The invite code and the job never travel in an address.
  expect(network.all.filter((entry) => entry.includes(invite) || entry.includes('?'))).toEqual([]);
  expect(fake.requests.every((request) => request.query === '')).toBe(true);
  expect(fake.uploads).toHaveLength(1);
  const upload = fake.uploads[0]!;
  expect(upload.contentType).toBe('audio/webm');
  expect(upload.durationS).toBe(24);

  // Nothing is left at the provider, the job is settled, and it was this browser's own name for it.
  await expect.poll(() => fake.providerState()).toEqual({ transcripts: [{ deleted: true }], uploads: 0 });
  expect(fake.jobs().map((job) => [job.state, job.atProvider])).toEqual([['completed', false]]);
  expect(fake.requests.find((request) => request.method === 'POST')?.jobIdHeader).toBe(fake.jobs()[0]!.id);

  // The text file says where it was written and who spoke.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('transcript-save-txt').click()]);
  const saved = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(saved);
  const text = readFileSync(saved, 'utf8');
  expect(text.split('\r\n')[0]).toBe(ct('cloud.file.header'));
  expect(text).toContain('[00:01] 1. kişi: Merhaba, bugün videoyu yazıya döküyoruz.');
  expect(text).toContain('[00:04] 2. kişi: Çok iyi, ben de dinliyorum.');

  // The editor gets the same track as an on-device transcript: its "Yazı" panel, search and kesit work on it unchanged.
  await page.getByTestId('wizard-open-editor').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 30_000 });
  expect(await lineTexts(page)).toEqual(SCRIPT_LINES);
  await page.getByTestId('transcript-check').nth(1).click();
  await page.getByTestId('transcript-make-kesit').click();
  await expect(page.getByTestId('transcript-status')).toHaveText('1 kesit eklendi. Geri al ile vazgeçebilirsin.');
  await expect(page.getByTestId('side-tab-kesit')).toHaveText('Kesitler (1)');
  // … and the panel's own search finds a word of it.
  expect(await page.getByTestId('transcript-machine-note').innerText()).toContain('yanlış olabilir');
  expect(FAKE_ORIGIN).toContain('127.0.0.1');
});

test('the uploaded bytes are sound only: one audio stream, no picture, nothing of the source file', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 0 });
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });

  const upload = fake.uploads[0]!;
  const probed = probeUpload(testInfo, upload.bytes, 'upload.webm');
  // Exactly one stream, and it is audio: no video stream, no subtitle or data track.
  expect(probed.streams.map((stream) => stream.codec_type)).toEqual(['audio']);
  expect(probed.streams[0]).toMatchObject({ codec_name: 'opus', channels: 1 });
  expect(probed.format.format_name).toContain('webm');
  // The whole sound, on the video's own clock: 24 s.
  expect(Number(probed.format.duration)).toBeGreaterThan(23.9);
  expect(Number(probed.format.duration)).toBeLessThan(24.2);
  // Compact: far under the proxy's ceiling of 8000 bytes per second (64 kbit/s).
  expect(upload.bytes.length / 24).toBeLessThan(8000);
  expect(upload.bytes.length).toBeGreaterThan(2000);
  // Nothing of the source file travels along: not its name, no title, no dates, no device or place.
  const tags = { ...(probed.format.tags ?? {}), ...(probed.streams[0]?.tags ?? {}) };
  const tagNames = Object.keys(tags).map((key) => key.toLowerCase());
  for (const forbidden of ['title', 'creation_time', 'location', 'com.apple.quicktime.location.iso6709', 'make', 'model', 'artist', 'comment']) {
    expect(tagNames, `tag ${forbidden}`).not.toContain(forbidden);
  }
  const raw = upload.bytes.toString('latin1');
  expect(raw).not.toContain('sample-24s');
  // An MP4 box of the source ("ftyp", "moov", "avc1") inside it would mean the container was copied.
  for (const marker of ['ftyp', 'moov', 'avc1']) expect(raw.includes(marker), marker).toBe(false);
  console.log(`CLOUD-AUDIO ${JSON.stringify({ seconds: 24, bytes: upload.bytes.length, bytesPerMinute: Math.round((upload.bytes.length / 24) * 60), codec: probed.streams[0]?.codec_name, tags })}`);
});

test('not one byte of sound leaves before the button is pressed', async ({ page, context, baseURL }) => {
  const network = watchNetwork(context, baseURL);
  const invite = fake.newInvite(60);
  await openReady(page, invite);
  // With a saved code the screen asks how many minutes are left — with the code in a header, and nothing else.
  expect(network.external().map((entry) => entry.replace(/^OPTIONS/, 'GET'))).toEqual(expect.arrayContaining([`GET ${FAKE_ORIGIN}/v1/quota`]));
  expect(new Set(network.external().map((entry) => entry.split(' ')[1]))).toEqual(new Set([`${FAKE_ORIGIN}/v1/quota`]));
  // Reading the screen, focusing the buttons, waiting: still nothing.
  await page.getByTestId('route-online-go').focus();
  await page.getByTestId('route-device-go').hover();
  await page.waitForTimeout(1500);
  expect(sent()).toEqual(['GET /v1/quota']);
  expect(fake.requests.every((request) => request.bytes === 0)).toBe(true);
  expect(fake.uploads).toHaveLength(0);
  expect(fake.jobs()).toEqual([]);
});

test('real numbers while it runs: seconds prepared, bytes sent, then no number at all', async ({ page }) => {
  test.setTimeout(240_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, holdUpload: true, pollsUntilDone: 3 });
  await openReady(page, invite, longVideo(10));
  await page.getByTestId('route-online-go').click();

  // "Ses hazırlanıyor": the seconds of sound encoded so far, of the video's length — or no number.
  const phase = page.getByTestId('cloud-phase');
  await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'preparing');
  await expect(phase).toHaveText(/^Ses hazırlanıyor(: \d+:\d{2} \/ 10:00)?$/);
  await expect(page.getByTestId('wizard-footer')).toHaveText(ct('cloud.footer.sending'));

  // "Gönderiliyor": bytes handed to the network, of the sound file's real size.
  await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'uploading', { timeout: 120_000 });
  await expect.poll(() => fake.requests.find((request) => request.method === 'POST')?.bytes ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  const total = Number(await page.locator('[data-testid="cloud-running"] [role="progressbar"]').getAttribute('aria-valuemax'));
  await expect.poll(() => fake.requests.find((request) => request.method === 'POST')?.bytes).toBe(total);
  await expect(phase).toHaveText(/^Gönderiliyor: [\d,]+ (KB|MB) \/ [\d,]+ (KB|MB)$/);
  const now = Number(await page.locator('[data-testid="cloud-running"] [role="progressbar"]').getAttribute('aria-valuenow'));
  expect(now).toBeLessThanOrEqual(total);
  expect(await page.locator('body').innerText()).not.toMatch(/%/);
  console.log(`CLOUD-AUDIO ${JSON.stringify({ seconds: 600, bytes: total, bytesPerMinute: Math.round(total / 10), note: 'a quiet 220 Hz tone, not speech' })}`);

  // "Yazılıyor…": nobody knows how far the provider is, so no number and no bar position — only the clock.
  fake.releaseUpload();
  await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'writing', { timeout: 30_000 });
  await expect(phase).toHaveText(ct('cloud.run.writing'));
  await expect(page.locator('[data-testid="cloud-running"] [role="progressbar"]')).not.toHaveAttribute('aria-valuenow');
  await expect(page.getByTestId('cloud-elapsed')).toHaveText(/^Geçen süre \d+:\d{2}\.$/);
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 60_000 });
});

test('never chosen for the user and never remembered: the next video asks again', async ({ page }) => {
  test.setTimeout(240_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 0 });
  await openReady(page, invite);
  // Neither way is marked as chosen, and nothing starts by itself.
  await expect(page.locator('[data-testid="route-choice"] input[type="radio"], [data-testid="route-choice"] [aria-pressed], [data-testid="route-choice"] [aria-checked], [data-testid="route-choice"] [aria-selected]')).toHaveCount(0);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(fake.uploads).toHaveLength(1);

  // The same video again, in the same tab: the question again, and nothing is sent until it is answered.
  await page.getByTestId('video-input').setInputFiles(longVideo(2));
  await expect(page.getByTestId('route-choice')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('wizard-title')).toHaveText(ct('cloud.choice.title'));
  await expect(page.getByTestId('route-online-go')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(fake.uploads).toHaveLength(1);

  // A new visit, the code still saved: the question again. The only thing kept in the browser is the code.
  await page.reload();
  await page.getByTestId('video-input').setInputFiles(longVideo(2));
  await expect(page.getByTestId('route-choice')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  expect(fake.uploads).toHaveLength(1);
  const stored = await page.evaluate(() => Object.keys(window.localStorage));
  expect(stored).toEqual(['clip.cloudInvite']);
  expect(await page.evaluate(() => Object.keys(window.sessionStorage))).toEqual([]);
});

test('"Cihazımda yaz" is the on-device route as it always was, and touches no other host', async ({ page, context, baseURL }) => {
  test.setTimeout(240_000);
  const network = watchNetwork(context, baseURL);
  const models = testModels();
  await serveModels(context, models);
  await installTranscriptTest(page, models, STUB_SCRIPT);
  await openChoice(page);
  // The model is not here yet: the card says what the first time costs, and the button leads to the download step.
  await expect(page.getByTestId('route-device-time')).toContainText('model indirilir');
  await page.getByTestId('route-device-go').click();
  await expect(page.getByTestId('transcribe-steps')).toBeVisible();
  await expect(page.getByTestId('wizard-title')).not.toHaveText(ct('cloud.choice.title'));
  // One step back to the question is always offered while nothing runs.
  await page.getByTestId('route-back').click();
  await expect(page.getByTestId('route-choice')).toBeVisible();
  await page.getByTestId('route-device-go').click();
  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(await lineTexts(page)).toEqual(STUB_LINES);
  // On-device words on the result: not "İnternette yazıldı", no speakers, the usual footer.
  await expect(page.getByTestId('transcript-machine-note')).not.toContainText(ct('cloud.machine'));
  await expect(page.getByTestId('transcript-speaker')).toHaveCount(0);
  await expect(page.getByTestId('yazi-summary')).toBeVisible();
  await expect(page.getByTestId('wizard-footer')).not.toHaveText(ct('cloud.footer.sent'));
  expect(network.external()).toEqual([]);
  expect(fake.requests).toEqual([]);

  // With the model in the browser, "Cihazımda yaz" writes at once: no second button to find.
  await page.getByTestId('video-input').setInputFiles(longVideo(2));
  await expect(page.getByTestId('route-choice')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('route-device-time')).not.toContainText('model indirilir');
  await page.getByTestId('route-device-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(fake.requests).toEqual([]);
});

test('stop while the sound is being sent: the upload ends, the proxy is asked to delete, the question is back', async ({ page }) => {
  test.setTimeout(180_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, holdUpload: true });
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'uploading', { timeout: 60_000 });
  await expect.poll(() => fake.jobs().map((job) => job.state)).toEqual(['reserved']);
  // The status took the focus when the buttons went away, and the stop button is next.
  await expect(page.getByTestId('cloud-phase')).toBeFocused();
  await page.getByTestId('cloud-stop').click();

  await expect(page.getByTestId('cloud-notice')).toContainText(ct('cloud.stopped'));
  await expect(page.getByTestId('cloud-notice')).toBeFocused();
  // The job had not started: there is no transcript to delete, and the notice does not claim one was.
  await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.unstarted'));
  await expect(page.getByTestId('route-choice')).toBeVisible();
  await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
  // The upload was cut, the delete arrived, the reservation is given back and nothing was started at the provider.
  await expect.poll(() => fake.abortedUploads).toBe(1);
  expect(sent().filter((entry) => entry === 'DELETE /v1/jobs/:id')).toHaveLength(1);
  expect(fake.jobs().map((job) => job.state)).toEqual(['failed']);
  expect(fake.providerState().transcripts).toEqual([]);
  // The minutes are whole again, and both ways are offered again.
  await expect(page.getByTestId('route-minutes')).toHaveText(fill(ct('cloud.online.minutes'), { n: 1, x: 1, y: 59 }));
  await expect(page.getByTestId('route-online-go')).toBeEnabled();
  await expect(page.getByTestId('route-device-go')).toBeEnabled();
});

test('stop while the provider writes: deleted there at once', async ({ page }) => {
  test.setTimeout(180_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 500 });
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'writing', { timeout: 60_000 });
  await expect.poll(() => fake.providerState()).toEqual({ transcripts: [{ deleted: false }], uploads: 1 });
  await page.getByTestId('cloud-stop').click();
  await expect(page.getByTestId('cloud-notice')).toContainText(ct('cloud.stopped'));
  await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.deleted'));
  expect(fake.providerState()).toEqual({ transcripts: [{ deleted: true }], uploads: 0 });
  expect(fake.jobs().map((job) => job.atProvider)).toEqual([false]);
  await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
});

test('leaving in the middle (another video, or the page) stops the job and asks for the delete', async ({ page }) => {
  test.setTimeout(180_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 500 });
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'writing', { timeout: 60_000 });
  await page.goto('/');
  await expect.poll(() => fake.providerState(), { timeout: 15_000 }).toEqual({ transcripts: [{ deleted: true }], uploads: 0 });
  expect(sent().filter((entry) => entry === 'DELETE /v1/jobs/:id').length).toBeGreaterThanOrEqual(1);
});

test('the invite code can be removed on the card and on the privacy page', async ({ page }) => {
  const invite = fake.newInvite(60);
  await openReady(page, invite);
  await page.getByTestId('invite-remove').click();
  await expect(page.getByTestId('invite-note')).toHaveText(ct('cloud.invite.removed'));
  await expect(page.getByTestId('invite-form')).toBeVisible();
  await expect(page.getByTestId('route-online-go')).toHaveCount(0);
  expect(await storedInvite(page)).toBeNull();

  // Saved again, then removed from the privacy page.
  await enterInvite(page, invite);
  await expect(page.getByTestId('route-online-go')).toBeVisible();
  await page.goto('/gizlilik/');
  await expect(page.getByTestId('invite-storage-status')).toHaveText(ct('cloud.privacy.invite.present'));
  // The code itself is never shown.
  expect(await page.locator('body').innerText()).not.toContain(invite);
  await page.getByTestId('invite-storage-remove').click();
  await expect(page.getByTestId('invite-storage-status')).toHaveText(ct('cloud.invite.removed'));
  expect(await storedInvite(page)).toBeNull();
});

test('where the browser has no Opus encoder the sound goes as AAC in MP4 — still sound only', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 0 });
  await cloudHook(page, { codec: 'aac' });
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  // This machine's browser either has an AAC encoder for 16 kHz mono or it has not; both endings are honest ones.
  await page.locator('[data-testid="transcript-panel"], [data-testid="cloud-notice"]').first().waitFor({ timeout: 120_000 });
  if ((await page.getByTestId('cloud-notice').count()) > 0) {
    testInfo.annotations.push({ type: 'note', description: 'no AAC encoder for 16 kHz mono in this browser: the fallback container was not exercised' });
    await expect(page.getByTestId('cloud-notice')).toContainText(ct('cloud.failed.audio_unavailable'));
    expect(fake.uploads).toHaveLength(0);
    console.log('CLOUD-AAC {"available":false}');
    return;
  }
  const upload = fake.uploads[0]!;
  expect(upload.contentType).toBe('audio/mp4');
  const probed = probeUpload(testInfo, upload.bytes, 'upload.m4a');
  expect(probed.streams.map((stream) => stream.codec_type)).toEqual(['audio']);
  expect(probed.streams[0]).toMatchObject({ codec_name: 'aac', channels: 1 });
  expect(upload.bytes.length / 24).toBeLessThan(8000);
  console.log(`CLOUD-AAC ${JSON.stringify({ available: true, bytes: upload.bytes.length, sampleRate: probed.streams[0]?.sample_rate })}`);
});
