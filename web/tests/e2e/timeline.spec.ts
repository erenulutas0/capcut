import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { timelineFixture } from './timeline-media';

/**
 * The single timeline (ADR-019), replaying the first real user test:
 * a 1:50 portrait phone video, cut with the timeline only.
 *
 * Screenshots for the ADR are written only with TIMELINE_SHOTS=1, so a normal
 * run never rewrites tracked files.
 */

const SHOTS = process.env.TIMELINE_SHOTS === '1';
const SHOT_DIR = join(process.cwd(), 'screenshots');

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  // Let the preview decode the frame it was just moved to.
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

async function openEditor(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('open-export')).toBeVisible();
  return errors;
}

async function openPortrait(page: Page) {
  const { file } = timelineFixture('portrait');
  await page.getByTestId('video-input').setInputFiles(file);
  await expect(page.getByTestId('preview-video')).toBeVisible();
}

function ranges(page: Page) {
  return page.getByTestId('moment-card').locator('.moment-range');
}

/** "01:02.500" -> seconds */
function seconds(timecode: string): number {
  const [clock = '0', ms = '0'] = timecode.trim().split('.');
  const parts = clock.split(':').map(Number);
  let total = 0;
  for (const part of parts) total = total * 60 + part;
  return total + Number(`0.${ms}`);
}

async function currentSeconds(page: Page): Promise<number> {
  return seconds((await page.getByTestId('current-time').textContent()) ?? '');
}

/** Clicks the timeline lane at an output time, using the lane's own scale. */
async function clickTimelineAt(page: Page, atS: number, referenceS: number) {
  const lane = page.getByTestId('timeline-lane');
  const box = await lane.boundingBox();
  if (!box) throw new Error('timeline not visible');
  await page.mouse.click(box.x + (box.width * atS) / referenceS, box.y + box.height / 2);
}

async function playheadTo(page: Page, atS: number) {
  const playhead = page.getByTestId('timeline-playhead');
  await playhead.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < atS; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId('current-time')).toHaveText(new RegExp(`^0?${Math.floor(atS / 60)}:${String(atS % 60).padStart(2, '0')}\\.000$`));
}

async function dragBy(page: Page, handle: Locator, dx: number, release = true) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  if (release) await page.mouse.up();
}

/** Seconds of a moment-list range "00:26.000 — 01:50.000". */
async function rangeLengths(page: Page): Promise<number[]> {
  const texts = await ranges(page).allTextContents();
  return texts.map((text) => {
    const [from = '', to = ''] = text.split('—');
    return Math.round((seconds(to) - seconds(from)) * 1000) / 1000;
  });
}

function tenths(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} sn`;
}

test.describe('single timeline: the user-test story', () => {
  test('open, split, delete, trim, undo/redo and export with one playhead', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await openEditor(page);
    await openPortrait(page);

    // 1. The whole video is one piece, and the preview shows the result.
    await expect(page.getByTestId('strip-clip')).toHaveCount(1);
    await expect(page.getByTestId('output-summary')).toHaveText('1 parça · 1:50 dk');
    await expect(ranges(page)).toHaveText(['00:00.000 — 01:50.000']);
    await expect(page.getByRole('tab', { name: 'Sonuç' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('total-time')).toHaveText('01:50.000');
    await expect(page.getByTestId('timeline-notice')).toContainText('tek parça olarak eklendi (1 dk 50,0 sn)');
    await shot(page, 'timeline-import-desktop-1440x900.png');

    // 2. Clicking the strip moves the one playhead there (output time).
    await clickTimelineAt(page, 26, 110);
    await expect.poll(() => currentSeconds(page)).toBeGreaterThan(25.4);
    expect(await currentSeconds(page)).toBeLessThan(26.6);
    // The clicked piece is selected.
    await expect(page.getByTestId('strip-clip').first()).toHaveAttribute('data-selected', 'true');

    // Exact positions with the keyboard: Shift+Arrow is one second.
    await playheadTo(page, 26);

    // 3. "Böl" cuts the piece under the playhead — no "select first" error.
    await page.getByTestId('split-selected').click();
    await expect(ranges(page)).toHaveText(['00:00.000 — 00:26.000', '00:26.000 — 01:50.000']);
    await expect(page.getByTestId('timeline-notice')).toContainText(
      'Parça 01 ikiye bölündü: 26,0 sn + 1 dk 24,0 sn',
    );
    await expect(page.getByTestId('strip-error')).toHaveCount(0);

    // S does the same at 60 s.
    await playheadTo(page, 60);
    await page.keyboard.press('s');
    await expect(ranges(page)).toHaveText([
      '00:00.000 — 00:26.000',
      '00:26.000 — 01:00.000',
      '01:00.000 — 01:50.000',
    ]);

    // 4. Select the unwanted middle piece and delete it; the rest closes up.
    await page.getByTestId('strip-clip').nth(1).getByRole('button').click();
    await expect(page.getByTestId('strip-clip').nth(1)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('strip-clip').nth(1).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Delete');
    await expect(ranges(page)).toHaveText(['00:00.000 — 00:26.000', '01:00.000 — 01:50.000']);
    await expect(page.getByTestId('output-duration-us')).toHaveText('76000000');
    await expect(page.getByTestId('timeline-notice')).toContainText('Parça 02 silindi (34,0 sn)');
    await shot(page, 'timeline-split-delete-desktop-1440x900.png');

    // The strip kept its scale: the removed 34 s is empty track, not stretched away.
    const lane = await page.getByTestId('timeline-lane').boundingBox();
    const second = await page.getByTestId('strip-clip').nth(1).boundingBox();
    if (!lane || !second) throw new Error('timeline not laid out');
    expect(second.x + second.width).toBeLessThan(lane.x + lane.width * (76 / 110) + 3);
    await expect(page.getByTestId('timeline-fit')).toBeVisible();

    // 5. Drag the end of the last piece 10 s to the left. The scale is frozen:
    //    nothing else moves, a ghost shows what goes, a label shows the length.
    await page.getByTestId('strip-clip').nth(1).getByRole('button').click();
    const first = await page.getByTestId('strip-clip').first().boundingBox();
    const end = page.getByTestId('trim-end');
    const dx = -(lane.width * 10) / 110;
    await dragBy(page, end, dx, false);
    await expect(page.getByTestId('trim-ghost')).toHaveAttribute('data-kind', 'remove');
    const label = end.getByTestId('trim-label');
    await expect(label).toBeVisible();
    await expect(label).toHaveText(/^\d+,\d sn \(−\d+,\d sn\)$/);
    expect(await page.getByTestId('strip-clip').first().boundingBox()).toEqual(first);
    // Nothing is stored while the pointer is still down.
    await expect(ranges(page).nth(1)).toHaveText('01:00.000 — 01:50.000');
    await shot(page, 'timeline-drag-desktop-1440x900.png');
    await page.mouse.up();

    const [, trimmedS = 0] = await rangeLengths(page);
    expect(trimmedS).toBeGreaterThan(39.4);
    expect(trimmedS).toBeLessThan(40.6);
    await expect(page.getByTestId('timeline-notice')).toHaveText(
      `Parça 02 kısaltıldı: 50,0 sn → ${tenths(trimmedS)} · Geri al: Ctrl+Z`,
    );
    // After release the piece stays visibly shorter (it used to spring back
    // to full width): its right edge is where the pointer let go.
    const afterBox = await page.getByTestId('strip-clip').nth(1).boundingBox();
    if (!afterBox) throw new Error('piece missing');
    expect(afterBox.x + afterBox.width).toBeLessThan(lane.x + lane.width * ((26 + trimmedS) / 110) + 3);
    // The playhead parked on the new cut: the last kept frame of the piece.
    expect(Math.abs((await currentSeconds(page)) - (26 + trimmedS))).toBeLessThan(0.1);

    // 6. Undo and redo, one step each.
    await page.keyboard.press('Control+z');
    await expect(ranges(page).nth(1)).toHaveText('01:00.000 — 01:50.000');
    await page.keyboard.press('Control+Shift+z');
    const [, redoneS = 0] = await rangeLengths(page);
    expect(redoneS).toBe(trimmedS);

    // A drag can never leave a sub-second leftover by accident.
    await dragBy(page, page.getByTestId('trim-end'), -lane.width);
    await expect(page.getByTestId('timeline-notice')).toContainText('0,5 sn');
    const [, heldS = 0] = await rangeLengths(page);
    expect(heldS).toBeGreaterThanOrEqual(0.5);
    expect(heldS).toBeLessThan(0.54);
    await page.keyboard.press('Control+z');
    const [, backS = 0] = await rangeLengths(page);
    expect(backS).toBe(trimmedS);

    // 7. Export works on the edited timeline.
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-quality').selectOption('720');
    await page.getByTestId('export-ready').waitFor({ timeout: 60_000 });
    await page.getByTestId('export-create').click();
    await page.getByTestId('export-succeeded').waitFor({ timeout: 180_000 });
    const measured = seconds((await page.getByTestId('measured-duration').textContent()) ?? '');
    expect(Math.abs(measured - (26 + trimmedS))).toBeLessThan(0.1);
    expect(errors).toEqual([]);
  });

  test('the playhead is a keyboard slider; Home/End and frame steps', async ({ page }) => {
    await openEditor(page);
    await openPortrait(page);
    const playhead = page.getByTestId('timeline-playhead');
    await expect(playhead).toHaveAttribute('role', 'slider');
    await expect(playhead).toHaveAccessibleName('Oynatma çizgisi');
    await playhead.focus();
    await page.keyboard.press('End');
    expect(await currentSeconds(page)).toBeGreaterThan(109.9);
    await page.keyboard.press('Home');
    await expect(page.getByTestId('current-time')).toHaveText('00:00.000');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('current-time')).toHaveText('00:00.033');
    await expect(playhead).toHaveAttribute('aria-valuetext', '0,033 saniye, toplam 1 dakika 50 saniye');
    // Splitting 1 frame from the start is refused with a reason, not silently.
    await page.keyboard.press('s');
    await expect(page.getByTestId('strip-error')).toContainText('0,1 saniyeden yakın');
    await expect(page.getByTestId('strip-clip')).toHaveCount(1);
  });
});

test.describe('single timeline at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('tap to seek, split, delete and drag an edge by touch', async ({ page }) => {
    const errors = await openEditor(page);
    await openPortrait(page);
    await expect(page.getByTestId('strip-clip')).toHaveCount(1);
    await page.getByTestId('timeline-lane').scrollIntoViewIfNeeded();
    await shot(page, 'timeline-import-phone-390x844.png');

    const lane = await page.getByTestId('timeline-lane').boundingBox();
    if (!lane) throw new Error('timeline not visible');
    // Tap at about 40 s, then split there.
    await page.touchscreen.tap(lane.x + (lane.width * 40) / 110, lane.y + lane.height / 2);
    await expect.poll(() => currentSeconds(page)).toBeGreaterThan(38);
    expect(await currentSeconds(page)).toBeLessThan(42);
    await page.getByTestId('split-selected').click();
    await expect(page.getByTestId('strip-clip')).toHaveCount(2);

    // The second half is selected after a split: "Sil" removes it.
    await expect(page.getByTestId('strip-clip').nth(1)).toHaveAttribute('data-selected', 'true');
    await page.getByTestId('delete-selected').click();
    await expect(page.getByTestId('strip-clip')).toHaveCount(1);
    const keptUs = Number(await page.getByTestId('output-duration-us').textContent());
    expect(keptUs).toBeGreaterThan(38_000_000);
    expect(keptUs).toBeLessThan(42_000_000);

    // Drag the remaining piece's end 10 s left with a finger (real touch
    // events through the browser, so pointerType is "touch").
    await page.getByTestId('strip-clip').first().getByRole('button').click();
    const end = page.getByTestId('trim-end');
    const box = await end.boundingBox();
    if (!box) throw new Error('handle not visible');
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    const client = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const dx = -(lane.width * 10) / 110;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 8, y }],
      });
    }
    await expect(page.getByTestId('trim-ghost')).toBeVisible();
    await shot(page, 'timeline-drag-phone-390x844.png');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByTestId('timeline-notice')).toContainText('Parça 01 kısaltıldı');
    const trimmedUs = Number(await page.getByTestId('output-duration-us').textContent());
    expect(keptUs - trimmedUs).toBeGreaterThan(9_000_000);
    expect(keptUs - trimmedUs).toBeLessThan(11_000_000);

    // Split once more so the screenshot shows the edited timeline.
    await page.getByTestId('timeline-playhead').focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('s');
    await expect(page.getByTestId('strip-clip')).toHaveCount(2);
    await page.getByTestId('timeline-lane').scrollIntoViewIfNeeded();
    await shot(page, 'timeline-split-delete-phone-390x844.png');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});

test.describe('the automatic piece is clearly undoable', () => {
  test('undo empties the timeline, keeps the video, and offers it back', async ({ page }) => {
    await openEditor(page);
    await openPortrait(page);
    await expect(page.getByTestId('strip-clip')).toHaveCount(1);

    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('strip-clip')).toHaveCount(0);
    await expect(page.getByTestId('preview-video')).toBeVisible();
    await expect(page.getByTestId('source-meta')).toContainText('portrait-110s.mp4');
    // Nothing to show as a result: the preview is the source, with the range form.
    await expect(page.getByRole('tab', { name: 'Kaynak', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('range-start')).toBeVisible();

    await page.getByTestId('timeline-add-whole').click();
    await expect(ranges(page)).toHaveText(['00:00.000 — 01:50.000']);
    await expect(page.getByRole('tab', { name: 'Sonuç' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('timeline-notice')).toContainText('tek parça olarak eklendi (1 dk 50,0 sn)');
  });
});

test.describe('videos the timeline cannot take whole', () => {
  // Policy v3 (doc 15, ADR-020): the output limit is 60 minutes, the same as
  // the input limit, so a video that opens at all now fits as one piece. The
  // "too long" choice (İlk N dakikayı ekle / Aralık seçerek ekle) stays for a
  // stricter policy and is covered by the unit tests; a browser cannot reach
  // it with v3, because a video over 60 minutes is refused on open (below).
  test('a video longer than the old 5-minute limit arrives whole (policy v3)', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    const { file } = timelineFixture('long');
    await page.getByTestId('video-input').setInputFiles(file);
    await expect(page.getByTestId('preview-video')).toBeVisible();

    await expect(page.getByTestId('timeline-too-long')).toHaveCount(0);
    await expect(page.getByTestId('strip-clip')).toHaveCount(1);
    await expect(page.getByTestId('output-summary')).toHaveText('1 parça · 5:10 dk');
    await expect(ranges(page)).toHaveText(['00:00.000 — 05:10.000']);
    await expect(page.getByTestId('timeline-notice')).toContainText('tek parça olarak eklendi (5 dk 10,0 sn)');
    await expect(page.getByRole('tab', { name: 'Sonuç' })).toHaveAttribute('aria-selected', 'true');
  });

  test('a rejected file is named, the open video stays, the message can be closed', async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await openPortrait(page);
    const { file } = timelineFixture('tooLong');
    await page.getByTestId('video-input').setInputFiles(file);

    const error = page.getByTestId('media-error');
    await expect(error).toHaveText(
      '“uzun-video.mp4” açılamadı: video bu sürümdeki 60 dakika sınırının üzerinde. Açık olan videon değişmedi.',
      { timeout: 60_000 },
    );
    await expect(error).toHaveAttribute('role', 'alert');
    // The open video and its timeline are untouched.
    await expect(page.getByTestId('source-meta')).toContainText('portrait-110s.mp4');
    await expect(page.getByTestId('strip-clip')).toHaveCount(1);

    await page.getByTestId('media-error-dismiss').click();
    await expect(error).toHaveCount(0);

    // Shown again for another rejection, cleared by the next successful edit.
    await page.getByTestId('video-input').setInputFiles(file);
    await expect(error).toBeVisible({ timeout: 60_000 });
    await playheadTo(page, 30);
    await page.getByTestId('split-selected').click();
    await expect(page.getByTestId('strip-clip')).toHaveCount(2);
    await expect(error).toHaveCount(0);
  });

  test('without an open video the message does not claim one stayed open', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('video-input').setInputFiles({
      name: 'bozuk.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('not a real mp4'),
    });
    const error = page.getByTestId('media-error');
    await expect(error).toContainText('“bozuk.mp4” açılamadı: ');
    await expect(error).not.toContainText('değişmedi');
  });
});
