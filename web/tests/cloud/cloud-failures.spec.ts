import { expect, test } from '../e2e/fixtures';

import { STUB_LINES, STUB_SCRIPT, installTranscriptTest, longVideo, serveModels, testModels } from '../e2e/transcriptKit';
import {
  FAKE_ORIGIN,
  SCRIPT_WORDS,
  cloudHook,
  ct,
  enterInvite,
  expectHonestFailure,
  fill,
  lineTexts,
  openChoice,
  openReady,
  seedInvite,
  startFake,
  storedInvite,
  type FakeWorker,
} from './cloudKit';

/**
 * Every way the cloud route can end without a transcript (ADR-039 "Hata
 * durumları"), against the LOCAL FAKE of our proxy. Each one must say in
 * plain words what happened, leave nothing at the provider when that can be
 * helped, never look like a success, never spin for ever — and always leave
 * "Cihazımda yaz" one press away.
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

test.describe('before anything is sent', () => {
  test('the proxy cannot be reached: the card says so, offers to ask again, and the on-device way stays', async ({ page, context }) => {
    const invite = fake.newInvite(60);
    // No route to the proxy (the Worker is down, its daily limit is used up, the network is gone).
    await context.route(`${FAKE_ORIGIN}/**`, (route) => route.abort('connectionrefused'));
    await seedInvite(page, invite);
    await openChoice(page);
    await expect(page.getByTestId('route-minutes')).toHaveText(ct('cloud.online.unreachable'));
    await expect(page.getByTestId('route-online-go')).toHaveCount(0);
    await expect(page.getByTestId('route-device-go')).toBeEnabled();
    // The saved code is kept: the proxy being away says nothing about the code.
    expect(await storedInvite(page)).toBe(invite);
    expect(fake.requests).toEqual([]);
    // It is back: "Yeniden dene" asks again.
    await context.unroute(`${FAKE_ORIGIN}/**`);
    await page.getByTestId('route-retry').click();
    await expect(page.getByTestId('route-minutes')).toHaveText(fill(ct('cloud.online.minutes'), { n: 1, x: 1, y: 59 }));
    await expect(page.getByTestId('route-online-go')).toBeEnabled();
  });

  test('switched off (the founder\'s switch, or the monthly cap): the card says so and offers only the on-device way', async ({ page }) => {
    const invite = fake.newInvite(60);
    fake.kill(true);
    await seedInvite(page, invite);
    await openChoice(page);
    await expect(page.getByTestId('route-minutes')).toHaveText(ct('cloud.online.off'));
    await expect(page.getByTestId('route-online-go')).toHaveCount(0);
    await expect(page.getByTestId('route-device-go')).toBeEnabled();
    expect(await storedInvite(page)).toBe(invite);
    // A code typed while it is off is checked, found right and kept; the card still says why it cannot be used now.
    await page.getByTestId('invite-remove').click();
    await enterInvite(page, invite);
    await expect(page.getByTestId('route-minutes')).toHaveText(ct('cloud.online.off'));
    expect(await storedInvite(page)).toBe(invite);
    expect(fake.uploads).toHaveLength(0);
  });

  test('the invite code: not a code, a wrong code, the proxy away, a code that was withdrawn', async ({ page, context }) => {
    await openChoice(page);
    // Not shaped like a code: said at once, and sent nowhere.
    await enterInvite(page, 'merhaba');
    await expect(page.getByTestId('invite-error')).toHaveText(ct('cloud.invite.bad'));
    expect(fake.requests).toEqual([]);
    // Shaped like a code, unknown to the proxy.
    await enterInvite(page, 'AAAAA-BBBBB-CCCCC-DDDDD');
    await expect(page.getByTestId('invite-error')).toHaveText(ct('cloud.invite.invalid'));
    expect(await storedInvite(page)).toBeNull();
    await expect(page.getByTestId('route-device-go')).toBeEnabled();
    // The proxy is away: the code is not saved on a guess.
    await context.route(`${FAKE_ORIGIN}/**`, (route) => route.abort('connectionrefused'));
    await enterInvite(page, 'AAAAA-BBBBB-CCCCC-DDDDD');
    await expect(page.getByTestId('invite-error')).toHaveText(ct('cloud.invite.unreachable'));
    expect(await storedInvite(page)).toBeNull();
    await context.unroute(`${FAKE_ORIGIN}/**`);
    // A good code typed loosely (spaces, no dashes) is tidied and accepted.
    const invite = fake.newInvite(60);
    await enterInvite(page, `  ${invite.split('-').join(' ')} `);
    await expect(page.getByTestId('route-online-go')).toBeVisible();
    expect(await storedInvite(page)).toBe(invite);
    // Withdrawn later: the next visit says so, forgets it, and asks for a new one.
    fake.revokeInvite(invite);
    await page.reload();
    await page.getByTestId('video-input').setInputFiles(longVideo(2));
    await expect(page.getByTestId('invite-note')).toHaveText(ct('cloud.invite.expired'), { timeout: 60_000 });
    await expect(page.getByTestId('invite-form')).toBeVisible();
    expect(await storedInvite(page)).toBeNull();
  });

  test('not enough minutes, and a video longer than one job may be: said on the card, with nothing to press but the on-device way', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const invite = fake.newInvite(1);
    await seedInvite(page, invite);
    // Two minutes of sound, one minute left.
    await openChoice(page, longVideo(2));
    await expect(page.getByTestId('route-minutes')).toHaveText(fill(ct('cloud.online.notEnough'), { x: 2, y: 1 }));
    await expect(page.getByTestId('route-online-go')).toHaveCount(0);
    await expect(page.getByTestId('route-device-go')).toBeEnabled();

    // A proxy whose longest job is one minute: the same two minutes are too long, whatever the invite holds.
    await fake.close();
    fake = await startFake(baseURL, { maxJobMinutes: 1 });
    try {
      const big = fake.newInvite(600);
      // (Seeded again: scripts added to the page run in order on every load, so this one has the last word.)
      await seedInvite(page, big);
      await page.reload();
      await page.getByTestId('video-input').setInputFiles(longVideo(2));
      await expect(page.getByTestId('route-minutes')).toHaveText(fill(ct('cloud.online.tooLong'), { max: 1 }), { timeout: 60_000 });
      await expect(page.getByTestId('route-online-go')).toHaveCount(0);
      await expect(page.getByTestId('route-device-go')).toBeEnabled();
      expect(fake.uploads).toHaveLength(0);
    } finally {
      await fake.close();
      fake = await startFake(baseURL);
    }
  });

  test('a browser that cannot make the sound-only file: nothing is sent', async ({ page }) => {
    const invite = fake.newInvite(60);
    await cloudHook(page, { codec: 'none' });
    await openReady(page, invite);
    await page.getByTestId('route-online-go').click();
    await expectHonestFailure(page, 'cloud.failed.audio_unavailable', fake);
    await expect(page.getByTestId('cloud-cleanup')).toHaveCount(0);
    // Asked for the minutes before and after; nothing else ever reached the proxy.
    await expect.poll(sent).toEqual(['GET /v1/quota', 'GET /v1/quota']);
    expect(fake.uploads).toHaveLength(0);
  });
});

test.describe('refused when the sound arrives', () => {
  const cases = [
    { name: 'switched off meanwhile (the founder\'s switch, or the monthly cap)', arrange: () => fake.kill(true), key: 'cloud.failed.off' },
    { name: 'the invite was withdrawn meanwhile', arrange: (invite: string) => fake.revokeInvite(invite), key: 'cloud.failed.invite_invalid' },
    { name: 'the minutes were used up meanwhile', arrange: (invite: string) => fake.setInviteMinutes(invite, 0.1), key: 'cloud.failed.minutes_used_up' },
  ] as const;
  for (const item of cases) {
    test(item.name, async ({ page }) => {
      test.setTimeout(120_000);
      const invite = fake.newInvite(60);
      await openReady(page, invite);
      item.arrange(invite);
      await page.getByTestId('route-online-go').click();
      await expectHonestFailure(page, item.key, fake);
      // Refused at the proxy's door: nothing was passed on, so nothing is said to have been deleted.
      await expect(page.getByTestId('cloud-cleanup')).toHaveCount(0);
      expect(fake.uploads).toHaveLength(0);
      expect(fake.providerState()).toEqual({ transcripts: [], uploads: 0 });
      expect(sent().filter((entry) => entry.startsWith('DELETE'))).toEqual([]);
    });
  }

  test('another job of this invite is still running', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const invite = fake.newInvite(60);
    fake.provider({ pollsUntilDone: 500 });
    await openReady(page, invite);
    // The same invite starts a job from somewhere else (another tab, another device).
    const other = await fetch(`${FAKE_ORIGIN}/v1/jobs`, {
      method: 'POST',
      headers: { origin: new URL(baseURL ?? '').origin, authorization: `Bearer ${invite}`, 'content-type': 'audio/webm', 'x-audio-duration-s': '30' },
      body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]),
    });
    expect(other.status).toBe(202);
    await page.getByTestId('route-online-go').click();
    await expect(page.getByTestId('cloud-notice')).toContainText(ct('cloud.failed.busy'), { timeout: 60_000 });
    await expect(page.getByTestId('route-device-go')).toBeEnabled();
    await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
    // The other job is not ours to delete, and was not touched.
    expect(fake.jobs().map((job) => job.state)).toEqual(['running']);
    expect(sent().filter((entry) => entry.startsWith('DELETE'))).toEqual([]);
  });

  test('too many tries from this address', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await fake.close();
    fake = await startFake(baseURL, { rateLimitPerHour: 1 });
    try {
      const invite = fake.newInvite(60);
      fake.provider({ pollsUntilDone: 0, words: [] });
      await openReady(page, invite);
      await page.getByTestId('route-online-go').click();
      await expectHonestFailure(page, 'cloud.failed.empty', fake);
      await page.getByTestId('route-online-go').click();
      await expectHonestFailure(page, 'cloud.failed.rate_limited', fake);
    } finally {
      await fake.close();
      fake = await startFake(baseURL);
    }
  });
});

test.describe('after the sound left', () => {
  test('the connection drops in the middle of the upload', async ({ page }) => {
    test.setTimeout(120_000);
    const invite = fake.newInvite(60);
    fake.provider({ dropUploadAfterBytes: 2000 });
    await openReady(page, invite);
    await page.getByTestId('route-online-go').click();
    await expectHonestFailure(page, 'cloud.failed.upload_interrupted', fake);
    // What had arrived cannot be known from the browser: the delete is asked for, and nothing is claimed deleted.
    await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.unstarted'));
    expect(sent().filter((entry) => entry === 'DELETE /v1/jobs/:id')).toHaveLength(1);
    // (A browser may send a broken upload once more by itself: one or two cut uploads, never a finished one.)
    expect(fake.abortedUploads).toBeGreaterThanOrEqual(1);
    expect(fake.uploads).toHaveLength(0);
    expect(fake.providerState().transcripts).toEqual([]);
    // The minutes were given back.
    await expect(page.getByTestId('route-minutes')).toHaveText(fill(ct('cloud.online.minutes'), { n: 1, x: 1, y: 59 }));
  });

  test('the provider refuses the upload, or refuses to start', async ({ page }) => {
    test.setTimeout(180_000);
    const invite = fake.newInvite(60);
    await openReady(page, invite);
    for (const provider of [{ failUpload: 500, failCreate: 0 }, { failUpload: 0, failCreate: 429 }]) {
      fake.provider(provider);
      await page.getByTestId('route-online-go').click();
      await expectHonestFailure(page, 'cloud.failed.provider_error', fake);
      // The provider's own words never reach the screen.
      expect(await page.getByTestId('cloud-notice').innerText()).not.toMatch(/provider|upload|create|50\d|429/i);
      expect(fake.providerState().transcripts).toEqual([]);
      await expect(page.getByTestId('route-minutes')).toHaveText(fill(ct('cloud.online.minutes'), { n: 1, x: 1, y: 59 }));
    }
  });

  test('the provider fails the transcript', async ({ page }) => {
    test.setTimeout(120_000);
    const invite = fake.newInvite(60);
    fake.provider({ pollsUntilDone: 1, transcriptError: 'SECRET PROVIDER TEXT' });
    await openReady(page, invite);
    await page.getByTestId('route-online-go').click();
    await expectHonestFailure(page, 'cloud.failed.provider_error', fake);
    await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.deleted'));
    expect(await page.locator('body').innerText()).not.toContain('SECRET PROVIDER TEXT');
    expect(fake.providerState()).toEqual({ transcripts: [{ deleted: true }], uploads: 0 });
    // A failed job costs no minutes.
    await expect(page.getByTestId('route-minutes')).toHaveText(fill(ct('cloud.online.minutes'), { n: 1, x: 1, y: 59 }));
  });

  test('the status cannot be read any more, and the result cannot be fetched', async ({ page }) => {
    test.setTimeout(180_000);
    const invite = fake.newInvite(60);
    fake.provider({ pollsUntilDone: 0, failStatus: 500 });
    await openReady(page, invite);
    await page.getByTestId('route-online-go').click();
    await expectHonestFailure(page, 'cloud.failed.provider_error', fake);
    await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.deleted'));
    expect(fake.providerState()).toEqual({ transcripts: [{ deleted: true }], uploads: 0 });

    fake.provider({ failStatus: 0, failResult: 500, words: SCRIPT_WORDS });
    await page.getByTestId('route-online-go').click();
    await expectHonestFailure(page, 'cloud.failed.provider_error', fake);
    await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.deleted'));
    expect(fake.providerState().transcripts.every((transcript) => transcript.deleted)).toBe(true);
  });

  test('the result comes back empty: no transcript is shown as if it were one', async ({ page }) => {
    test.setTimeout(120_000);
    const invite = fake.newInvite(60);
    fake.provider({ pollsUntilDone: 0, words: [] });
    await openReady(page, invite);
    await page.getByTestId('route-online-go').click();
    await expectHonestFailure(page, 'cloud.failed.empty', fake);
    await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.deleted'));
    await expect(page.getByTestId('wizard-download')).toHaveCount(0);
    expect(fake.providerState()).toEqual({ transcripts: [{ deleted: true }], uploads: 0 });
  });

  test('the provider never finishes: given up after the limit, and deleted', async ({ page }) => {
    test.setTimeout(120_000);
    const invite = fake.newInvite(60);
    fake.provider({ pollsUntilDone: 100_000 });
    await cloudHook(page, { giveUpMs: 2500 });
    await openReady(page, invite);
    await page.getByTestId('route-online-go').click();
    await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'writing', { timeout: 60_000 });
    await expectHonestFailure(page, 'cloud.failed.timeout', fake);
    await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.deleted'));
    expect(fake.providerState()).toEqual({ transcripts: [{ deleted: true }], uploads: 0 });
  });

  test('the proxy goes away while the provider writes: said, and the delete that could not be asked is not claimed', async ({ page, context }) => {
    test.setTimeout(180_000);
    const invite = fake.newInvite(60);
    fake.provider({ pollsUntilDone: 100_000 });
    await openReady(page, invite);
    await page.getByTestId('route-online-go').click();
    await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'writing', { timeout: 60_000 });
    await context.route(`${FAKE_ORIGIN}/**`, (route) => route.abort('connectionrefused'));
    await expect(page.getByTestId('cloud-notice')).toContainText(ct('cloud.failed.unreachable'), { timeout: 90_000 });
    // The delete could not be asked for from here: the screen says that, and says who will do it.
    await expect(page.getByTestId('cloud-cleanup')).toHaveText(ct('cloud.cleanup.pending'));
    await expect(page.getByTestId('cloud-running')).toHaveCount(0);
    await expect(page.getByTestId('route-device-go')).toBeEnabled();
    await expect(page.getByTestId('transcript-panel')).toHaveCount(0);
    await expect(page.getByTestId('route-minutes')).toHaveText(ct('cloud.online.unreachable'));
  });
});

test('after a failure, "Cihazımda yaz" writes the transcript on the device and asks the proxy nothing more', async ({ page, context }) => {
  test.setTimeout(240_000);
  const models = testModels();
  await serveModels(context, models);
  await installTranscriptTest(page, models, STUB_SCRIPT);
  const invite = fake.newInvite(60);
  fake.provider({ pollsUntilDone: 0, words: [] });
  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expectHonestFailure(page, 'cloud.failed.empty', fake);
  const before = fake.requests.length;
  await page.getByTestId('route-device-go').click();
  await page.getByTestId('model-download').click();
  await expect(page.getByTestId('transcribe-start')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('transcribe-start').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(await lineTexts(page)).toEqual(STUB_LINES);
  await expect(page.getByTestId('transcript-machine-note')).not.toContainText(ct('cloud.machine'));
  expect(fake.requests.length).toBe(before);
});
