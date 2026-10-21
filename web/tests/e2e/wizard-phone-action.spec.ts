import { expect, test, type Page } from './fixtures';
import { installSavePicker } from './kesitFlow';
import { expectStylesApplied } from './stylesReady';
import { wizardFixture } from './wizard-media';

/**
 * 19 October 2026, the founder's phone (ADR-046 addendum): a vertical video
 * shared into "GIF yap" made the preview so tall that "GIF'i indir" sat below
 * the screen, and he could not find how to make the GIF. On a phone the one
 * main action of every wizard must be on the screen without scrolling — with
 * a vertical video, at 360 × 780 and at 320 px — a finger-sized target that
 * covers nothing a finger needs (the GIF's two text boxes, the part bar), and
 * the keyboard focus is never hidden under it (WCAG 2.4.11).
 */

const VERTICAL = () => wizardFixture('vertical'); // 360 × 640, 2 s, with sound

/**
 * The wizards with a step of their own (ADR-034), what each shows when it has looked at the video, and
 * its main action. "Kes" is not here: it opens the editor, whose phone bar is ADR-030's.
 * Measured before the fix (18 Oct build, 360 × 780, this video): the main action's bottom edge at
 * 1025 px (Küçült), 905 (Müzik ekle), 1507 (İyileştir), 898 (GIF yap) — below the screen; at 320 × 640
 * also Sesi düzelt (719) and Çevir (733).
 */
const WIZARDS: { id: string; ready?: (page: Page) => Promise<void>; file?: () => string; action?: string }[] = [
  {
    id: 'bosluk',
    file: () => wizardFixture('verticalGaps'),
    ready: (page) => expect(page.getByTestId('wizard-download')).toBeEnabled({ timeout: 120_000 }),
  },
  { id: 'dikey' },
  { id: 'kucult' },
  { id: 'yazi', action: 'model-download' },
  { id: 'muzik' },
  { id: 'ses' },
  { id: 'sustur' },
  { id: 'duzelt', ready: (page) => expect(page.getByTestId('duzelt-summary')).toBeVisible({ timeout: 120_000 }) },
  { id: 'cevir' },
  { id: 'iyilestir', ready: (page) => expect(page.getByTestId('enhance-preview')).toHaveAttribute('data-status', /ready|none|failed/, { timeout: 180_000 }) },
  {
    id: 'gif',
    ready: (page) => expect(page.getByTestId('gif-estimate')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 }),
  },
];

test.describe.configure({ timeout: 240_000 });
test.use({ storageState: { cookies: [], origins: [] } });

async function openWizard(page: Page, id: string, ready?: (page: Page) => Promise<void>, file = VERTICAL, language = ''): Promise<void> {
  await installSavePicker(page);
  await page.goto(`${language}/yap/${id}/`);
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pick');
  await page.getByTestId('video-input').setInputFiles(file());
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'choose', { timeout: 60_000 });
  if (ready) await ready(page);
  // Whatever the wizard measures after the video opened (the gaps, the sizes) has settled.
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Where the main action is, with the page not scrolled. */
async function actionBox(page: Page, action: string) {
  return page.getByTestId(action).evaluate((button) => {
    const box = button.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, width: box.width, height: box.height, viewport: window.innerHeight, scrollY: window.scrollY };
  });
}

for (const size of [
  { width: 360, height: 780 },
  { width: 320, height: 640 },
]) {
  test.describe(`${size.width} × ${size.height}, a vertical video`, () => {
    test.use({ viewport: size, hasTouch: true });

    for (const { id, ready, file, action = 'wizard-download' } of WIZARDS) {
      test(`${id}: the main action is on the screen without scrolling`, async ({ page }, testInfo) => {
        await openWizard(page, id, ready, file);
        await expectStylesApplied(page, `${id} ${size.width}`, testInfo);
        await expect(page.getByTestId(action)).toBeVisible({ timeout: 60_000 });
        const box = await actionBox(page, action);
        console.log(`PHONE-ACTION ${JSON.stringify({ id, ...size, ...box })}`);
        expect(box.scrollY).toBe(0);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(box.viewport);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        // Nothing scrolls sideways (320 px reflow).
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  });
}

/**
 * 21 October 2026: at 390 px and below, "Büyük" of GIF yap's size choice fell to a second line. The
 * three sizes share one row at 320, 360 and 390 px, in Turkish and in English; each stays a finger-
 * sized target (44 × 44, the quality budget `a11y.phone.*.under44`) and no word is cut or spills out
 * of its option.
 */
for (const language of [
  { prefix: '', locale: 'tr-TR', words: ['Küçük', 'Orta', 'Büyük'] },
  { prefix: '/en', locale: 'en-US', words: ['Small', 'Medium', 'Large'] },
]) {
  for (const width of [320, 360, 390]) {
    test.describe(`GIF yap's three sizes, ${width} px, ${language.locale}`, () => {
      test.use({ viewport: { width, height: 780 }, hasTouch: true, locale: language.locale });

      test('Küçük, Orta and Büyük share one row, each at least 44 × 44, no word cut', async ({ page }) => {
        await openWizard(
          page,
          'gif',
          (p) => expect(p.getByTestId('gif-estimate')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 }),
          VERTICAL,
          language.prefix,
        );
        const options = page.getByTestId('gif-size').locator('label.gif-size-option');
        await expect(options).toHaveCount(3);
        await expect(options).toHaveText(language.words);
        const boxes = await options.evaluateAll((labels) =>
          labels.map((label) => {
            const box = label.getBoundingClientRect();
            const word = label.querySelector('span') as HTMLElement;
            const wordBox = word.getBoundingClientRect();
            return {
              top: box.top,
              left: box.left,
              right: box.right,
              width: box.width,
              height: box.height,
              // The word is whole: it is not wider than it is drawn, and it lies inside its option.
              wordWhole: word.scrollWidth <= Math.ceil(wordBox.width) && wordBox.left >= box.left && wordBox.right <= box.right,
            };
          }),
        );
        console.log(`GIF-SIZE-ROW ${JSON.stringify({ width, locale: language.locale, boxes })}`);
        for (const box of boxes) {
          expect(Math.abs(box.top - boxes[0]!.top), 'one row').toBeLessThan(1);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(box.wordWhole, 'the word is whole').toBe(true);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    });
  }
}

test.describe('the action bar covers nothing a finger or the keyboard needs (GIF yap, 360 × 780, vertical video)', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  test('the two text boxes, the part bar and the size are never under the bar; Tab never lands under it', async ({ page }) => {
    await openWizard(page, 'gif', (p) => expect(p.getByTestId('gif-estimate')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 }));
    const bar = page.getByTestId('wizard-download');
    // Without scrolling: both text boxes are on the screen, above the button.
    for (const testId of ['gif-text-top', 'gif-text-bottom']) {
      const [box, button] = await Promise.all([page.getByTestId(testId).boundingBox(), bar.boundingBox()]);
      expect(box, testId).not.toBeNull();
      expect(button).not.toBeNull();
      expect(box!.y + box!.height, `${testId} above the action`).toBeLessThanOrEqual(button!.y);
      expect(box!.y, `${testId} on the screen`).toBeGreaterThanOrEqual(0);
    }
    // Every control reached with Tab is fully visible, not under the bar.
    await page.getByTestId('gif-text-top').focus();
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      const hidden = await page.evaluate(() => {
        const focused = document.activeElement as HTMLElement | null;
        if (!focused || focused === document.body) return null;
        const actions = document.querySelector('[data-testid="wizard-actions"]');
        if (!actions || actions.contains(focused)) return null;
        const a = focused.getBoundingClientRect();
        const b = actions.getBoundingClientRect();
        const covered = a.bottom > b.top && a.top < b.bottom;
        return covered ? `${focused.getAttribute('data-testid') ?? focused.tagName} ${Math.round(a.top)}–${Math.round(a.bottom)} under ${Math.round(b.top)}` : null;
      });
      expect(hidden).toBeNull();
    }
  });
});
