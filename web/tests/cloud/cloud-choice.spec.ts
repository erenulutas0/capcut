import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '../e2e/fixtures';

import { watchCsp } from '../e2e/cspWatch';
import { expectStylesApplied } from '../e2e/stylesReady';
import { cloudEn } from '../../src/i18n/cloudMessages.en';
import { FAKE_ORIGIN, SCRIPT_WORDS, ct, fill, openChoice, openReady, plain, startFake, watchNetwork, type FakeWorker } from './cloudKit';

/**
 * "Yazıyı nerede çıkaralım?" — the consent screen the founder chose on
 * 11 Oct 2026 (option B, "İki yol yan yana"; docs/ux/2026-10-11-cloud-consent):
 * what it says, that the two ways weigh the same, and that it can be used
 * without a mouse, on a phone, with a screen reader. Against the LOCAL FAKE
 * of our proxy; nothing here is about how well speech is written.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
/** Words the screen must not use: nothing here can show them to be true (ADR-039 "Rıza ekranı"). */
const UNPROVABLE = /güvenli|şifreli|anonim|kimse dinlemez|eğitimde kullanılmaz|gizli kalır|%\s?100|garanti/i;

let fake: FakeWorker;
test.beforeAll(async ({}, testInfo) => {
  fake = await startFake(testInfo.project.use.baseURL);
});
test.afterAll(async () => {
  await fake.close();
});
test.beforeEach(() => fake.reset());

async function audit(page: Page, state: string, testInfo: TestInfo): Promise<void> {
  await expectStylesApplied(page, state, testInfo);
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const findings = result.violations.map((violation) => ({ rule: violation.id, impact: violation.impact ?? 'unknown', targets: violation.nodes.slice(0, 6).map((node) => node.target.join(' ')) }));
  if (findings.length > 0) await testInfo.attach(`axe-${state}`, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
  expect.soft(findings, `axe violations in state "${state}"`).toEqual([]);
}

const box = async (page: Page, testId: string) => {
  const rect = await page.getByTestId(testId).boundingBox();
  if (!rect) throw new Error(`${testId} has no box`);
  return rect;
};

/** Everything a finger or a pointer can press inside the screen, with its size. */
const targets = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="route-choice"] button, [data-testid="route-choice"] a[href], [data-testid="route-choice"] input, [data-testid="cloud-running"] button'))
      .filter((element) => element.offsetParent !== null)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { name: element.getAttribute('data-testid') ?? element.tagName, width: Math.round(rect.width), height: Math.round(rect.height) };
      }),
  );

/** The computed size of every piece of text on the screen (px). */
const textSizes = (page: Page, root: string) =>
  page.evaluate((selector) => {
    const out: { text: string; px: number }[] = [];
    const walker = document.createTreeWalker(document.querySelector(selector) as Element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('.visually-hidden') || parent.offsetParent === null) continue;
      out.push({ text: text.slice(0, 40), px: Number.parseFloat(getComputedStyle(parent).fontSize) });
    }
    return out;
  }, root);

test('what the screen says: the founder\'s two cards, word for word, and nothing we cannot show to be true', async ({ page }) => {
  const invite = fake.newInvite(60);
  await openReady(page, invite);
  await expect(page.getByTestId('wizard-title')).toHaveText('Yazıyı nerede çıkaralım?');

  const device = page.getByTestId('route-device');
  await expect(device.getByRole('heading', { level: 2 })).toHaveText('Cihazımda');
  await expect(device.locator('.route-card-body')).toHaveText('Hiçbir şey gitmez. Daha yavaş, biraz daha az doğru. Kimin konuştuğunu ayırmaz.');
  await expect(page.getByTestId('route-device-go')).toHaveText('Cihazımda yaz');
  // No invented number for the device: the honest wording of ADR-036, and what the first time costs.
  await expect(page.getByTestId('route-device-time')).toContainText('Konuşmanın süresinin yarısı kadar sürebilir; yavaş cihazda daha uzun.');
  expect(await page.getByTestId('route-device-time').innerText()).not.toMatch(/\d+ dakika/);

  const online = page.getByTestId('route-online');
  await expect(online.getByRole('heading', { level: 2 })).toHaveText('İnternette');
  await expect(online.locator('.route-card-body')).toHaveText('Daha doğru, çok daha hızlı. Kimin konuştuğunu da ayırır.');
  await expect(page.getByTestId('route-facts').locator('li')).toHaveText([
    'Yalnızca ses gider, görüntü gitmez.',
    'AssemblyAI adlı bir şirkete gider. Bilgisayarları Avrupa’da.',
    'Yazı gelince oradaki ses ve yazı silinir.',
    'Başka insanlar konuşuyorsa onların sesi de gider.',
  ]);
  await expect(page.getByTestId('route-facts').locator('strong')).toHaveText(['Yalnızca ses', 'AssemblyAI', 'silinir', 'onların sesi de gider']);
  // The minutes come from the proxy; the time is the measured estimate, said as "yaklaşık".
  await expect(page.getByTestId('route-minutes')).toHaveText('Yaklaşık 1 dakika sürer · 1 dakika düşer, 59 dakikan kalır');
  await expect(page.getByTestId('route-online-go')).toHaveText('Sesi gönder ve yaz');

  // Under both: the privacy page, in a new tab (leaving would close the video).
  const privacy = page.getByTestId('route-privacy');
  await expect(privacy).toContainText('Gizlilik sayfası');
  await expect(privacy).toHaveAttribute('target', '_blank');
  await expect(privacy).toHaveAttribute('href', /\/gizlilik\/?$/);

  const words = await page.getByTestId('route-choice').innerText();
  expect(words).not.toMatch(UNPROVABLE);
  expect(plain('cloud.online.fact.sound')).toBe('Yalnızca ses gider, görüntü gitmez.');
});

for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test.describe(`at ${name} size`, () => {
    test.use({ viewport });

    test('the two ways weigh the same: equal buttons, side by side on a desktop and stacked on a phone', async ({ page }) => {
      const invite = fake.newInvite(60);
      await openReady(page, invite);
      const device = await box(page, 'route-device-go');
      const online = await box(page, 'route-online-go');
      expect(Math.round(device.width)).toBe(Math.round(online.width));
      expect(Math.round(device.height)).toBe(Math.round(online.height));
      const size = (testId: string) => page.getByTestId(testId).evaluate((element) => [getComputedStyle(element).fontSize, getComputedStyle(element).fontWeight, getComputedStyle(element).borderTopWidth]);
      expect(await size('route-device-go')).toEqual(await size('route-online-go'));
      const deviceCard = await box(page, 'route-device');
      const onlineCard = await box(page, 'route-online');
      expect(Math.round(deviceCard.width)).toBe(Math.round(onlineCard.width));
      if (name === 'desktop') {
        // Side by side, the on-device card first, and the two buttons on one line.
        expect(deviceCard.x).toBeLessThan(onlineCard.x);
        expect(Math.round(deviceCard.y)).toBe(Math.round(onlineCard.y));
        expect(Math.round(device.y)).toBe(Math.round(online.y));
      } else {
        // Stacked, the on-device card first (as in the approved drawing).
        expect(deviceCard.y + deviceCard.height).toBeLessThanOrEqual(onlineCard.y);
        expect(Math.round(deviceCard.x)).toBe(Math.round(onlineCard.x));
      }
      // Nothing scrolls sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test('accessibility: axe, 44 px targets, 14 px text, a keyboard walk — without a code, with one, and while it runs', async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const invite = fake.newInvite(60);
      fake.provider({ words: SCRIPT_WORDS, holdUpload: true });

      // 1. No saved code: the invite form.
      await openChoice(page);
      await audit(page, `${name}-no-invite`, testInfo);
      for (const target of await targets(page)) {
        expect.soft(target.height, `${target.name} height`).toBeGreaterThanOrEqual(44);
        expect.soft(target.width, `${target.name} width`).toBeGreaterThanOrEqual(44);
      }
      for (const piece of await textSizes(page, '[data-testid="route-choice"]')) expect.soft(piece.px, `"${piece.text}"`).toBeGreaterThanOrEqual(14);
      // The field has a visible label and says what it is for and what went wrong.
      const field = page.getByTestId('invite-code');
      await expect(field).toHaveAccessibleName(ct('cloud.invite.label'));
      await expect(field).toHaveAccessibleDescription(new RegExp(ct('cloud.invite.need').slice(0, 20)));
      await field.fill('yanlış');
      await field.press('Enter');
      await expect(page.getByTestId('invite-error')).toHaveText(ct('cloud.invite.bad'));
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await audit(page, `${name}-invite-error`, testInfo);

      // 2. With a code: the order a keyboard meets things in is the order they are read in.
      await field.fill(invite);
      await field.press('Enter');
      await expect(page.getByTestId('route-online-go')).toBeVisible();
      await audit(page, `${name}-ready`, testInfo);
      for (const target of await targets(page)) expect.soft(target.height, `${target.name} height`).toBeGreaterThanOrEqual(44);
      for (const piece of await textSizes(page, '[data-testid="route-choice"]')) expect.soft(piece.px, `"${piece.text}"`).toBeGreaterThanOrEqual(14);
      await page.getByTestId('route-device-go').focus();
      const walk: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        walk.push((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) ?? '?');
        // Every stop shows where the focus is.
        expect(await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle), `focus ring on ${walk.at(-1)}`).not.toBe('none');
        await page.keyboard.press('Tab');
      }
      expect(walk).toEqual(['route-device-go', 'route-online-go', 'route-privacy', 'invite-remove']);

      // 3. Enter on the button starts it; the status takes the focus and is a live region; the bar says real bytes.
      await page.getByTestId('route-online-go').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('cloud-running')).toHaveAttribute('data-phase', 'uploading', { timeout: 60_000 });
      await expect(page.getByTestId('cloud-phase')).toBeFocused();
      await expect(page.getByTestId('cloud-phase')).toHaveAttribute('role', 'status');
      const bar = page.locator('[data-testid="cloud-running"] [role="progressbar"]');
      await expect(bar).toHaveAttribute('aria-valuetext', /Gönderiliyor: /);
      await audit(page, `${name}-running`, testInfo);
      for (const target of await targets(page)) expect.soft(target.height, `${target.name} height`).toBeGreaterThanOrEqual(44);
      for (const piece of await textSizes(page, '[data-testid="cloud-running"]')) expect.soft(piece.px, `"${piece.text}"`).toBeGreaterThanOrEqual(14);
      // Tab from the status reaches "Durdur"; Enter stops; the notice takes the focus and is announced.
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('cloud-stop')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('cloud-notice')).toBeFocused();
      await expect(page.getByTestId('cloud-notice')).toHaveAttribute('role', 'alert');
      await audit(page, `${name}-notice`, testInfo);
      for (const piece of await textSizes(page, '[data-testid="route-choice"]')) expect.soft(piece.px, `"${piece.text}"`).toBeGreaterThanOrEqual(14);

      // 4. The result: the speakers and the note are read with the lines.
      fake.provider({ holdUpload: false, pollsUntilDone: 0 });
      await page.getByTestId('route-online-go').click();
      await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
      await audit(page, `${name}-result`, testInfo);
      await expect(page.getByTestId('transcript-line').first()).toHaveAccessibleName(/1\. kişi/);
      for (const piece of await textSizes(page, '[data-testid="yazi-cloud-summary"]')) expect.soft(piece.px, `"${piece.text}"`).toBeGreaterThanOrEqual(14);
    });
  });
}

test('the policy of this build allows the proxy and nothing else; a whole cloud run trips nothing', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  const csp = await watchCsp(context);
  await csp.attach(page);
  const network = watchNetwork(context, baseURL);
  const invite = fake.newInvite(60);
  fake.provider({ words: SCRIPT_WORDS, pollsUntilDone: 1 });

  for (const path of ['/', '/editor', '/gizlilik', '/gizlilik/en', '/yap/yazi', '/yap/kes']) {
    await page.goto(path);
    const policy = (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ?? '';
    // Exactly one origin more than the published site's policy: no wildcard, no scheme-wide source, not the provider.
    expect(/connect-src ([^;]*)/.exec(policy)?.[1], path).toBe(`'self' ${FAKE_ORIGIN}`);
    expect(policy).toContain("default-src 'self'");
    expect(policy).not.toContain('assemblyai');
    expect(policy).not.toMatch(/connect-src[^;]*\*/);
  }

  await openReady(page, invite);
  await page.getByTestId('route-online-go').click();
  await expect(page.getByTestId('transcript-panel')).toBeVisible({ timeout: 120_000 });
  expect(csp.violations, csp.violations.join('\n')).toEqual([]);
  expect(network.strangers()).toEqual([]);

  // Any other origin is still refused by the browser — the policy, not good manners, keeps requests home.
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('http://127.0.0.1:38198/v1/quota');
      return 'allowed';
    } catch {
      return 'blocked';
    }
  });
  expect(blocked).toBe('blocked');
  await expect.poll(() => csp.violations.some((violation) => violation.includes('connect-src'))).toBe(true);
});

test('the privacy page of this build describes the route — what goes, to whom, where, deletion, the code on the device', async ({ page }) => {
  await page.goto('/gizlilik/');
  const section = page.getByTestId('privacy-cloud');
  await expect(section.getByRole('heading', { level: 2 })).toHaveText(ct('cloud.privacy.title'));
  const text = await section.innerText();
  for (const key of ['cloud.privacy.what', 'cloud.privacy.who', 'cloud.privacy.region', 'cloud.privacy.deletion', 'cloud.privacy.others', 'cloud.privacy.ledger', 'cloud.privacy.quota', 'cloud.privacy.trial'] as const) {
    expect(text).toContain(ct(key));
  }
  expect(text).toContain('AssemblyAI');
  expect(text).toContain('Avrupa Birliği');
  expect(text).not.toMatch(UNPROVABLE);
  // The sentences that would now be untrue are not on the page any more.
  const whole = await page.locator('main').innerText();
  expect(whole).not.toContain('hiçbir sunucuya gönderilmez');
  expect(whole).not.toContain('bulutta çalışan bir yapay zekâ kullanılmaz');
  expect(whole).not.toContain('Uygulama senin adına hiçbir şey göndermez');
  await expect(page.getByTestId('privacy-local')).toHaveText(ct('cloud.privacy.summary.local'));
  await expect(page.getByTestId('privacy-not-collected')).toHaveText(ct('cloud.privacy.notCollected.body'));
  await expect(page.getByTestId('privacy-network-cloud')).toHaveText(ct('cloud.privacy.network.extra'));
  // The invite code: where it is kept and how it goes away.
  const card = page.getByTestId('stored-invite');
  await expect(card).toContainText('clip.cloudInvite');
  await expect(page.getByTestId('invite-storage-status')).toHaveText(ct('cloud.privacy.invite.absent'));
  // Who is responsible is still undecided, and the page still says so rather than inventing it.
  await expect(page.getByTestId('privacy-draft')).toBeVisible();
  expect(await page.getByTestId('undecided').count()).toBeGreaterThan(0);

  // English: the same section, from the same keys.
  await page.goto('/gizlilik/en/');
  await expect(page.getByTestId('privacy-cloud').getByRole('heading', { level: 2 })).toHaveText(cloudEn['cloud.privacy.title']);
  await expect(page.getByTestId('privacy-cloud')).toContainText(cloudEn['cloud.privacy.region']);
  await expect(page.getByTestId('invite-storage-status')).toHaveText(cloudEn['cloud.privacy.invite.absent']);
  expect(fill('{n}', { n: 1 })).toBe('1');
});
