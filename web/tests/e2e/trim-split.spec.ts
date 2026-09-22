import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { startWithEmptyTimeline } from './rangeFlow';

const SAMPLE_VIDEO = join(process.cwd(), 'tests', 'media', 'sample-24s.mp4');

async function openWithSample(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByTestId('open-export')).toBeVisible();
  await page.getByTestId('video-input').setInputFiles(SAMPLE_VIDEO);
  await expect(page.getByTestId('preview-video')).toBeVisible();
  // These tests build their pieces with the range flow (ADR-019).
  await startWithEmptyTimeline(page);
  await expect(page.getByTestId('total-time')).toHaveText('00:24.000');
  return errors;
}

async function addMoment(page: Page, start: string, end: string) {
  await page.getByTestId('range-start').fill(start);
  await page.getByTestId('range-end').fill(end);
  await page.getByTestId('add-moment').click();
}

async function seek(page: Page, ms: number) {
  await page.getByLabel('Zamanda gezin').fill(String(ms));
}

function ranges(page: Page) {
  return page.getByTestId('moment-card').locator('.moment-range');
}

/** Presses the pointer on a handle, moves by dx in steps, and returns. */
async function dragBy(page: Page, handle: Locator, dx: number, release = true) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  if (release) await page.mouse.up();
}

async function valueNow(handle: Locator): Promise<number> {
  return Number(await handle.getAttribute('aria-valuenow'));
}

function expectOnFrameGrid(seconds: number) {
  const frames = seconds * 30;
  expect(Math.abs(frames - Math.round(frames))).toBeLessThan(0.001);
}

test.describe('trim handles', () => {
  test('dragging the start handle trims the piece, snaps to frames, and undoes in one step', async ({
    page,
  }) => {
    const errors = await openWithSample(page);
    await addMoment(page, '00:04.000', '00:08.000');
    await addMoment(page, '00:12.000', '00:16.000');

    // Select the first piece on the timeline; only the selected one has handles.
    await page.getByTestId('strip-clip').first().getByRole('button').click();
    const start = page.getByTestId('trim-start');
    await expect(start).toHaveCount(1);
    await expect(start).toHaveAttribute('aria-valuenow', '4');
    await expect(start).toHaveAttribute('aria-valuetext', '4 saniye');

    // Touch-sized hit area.
    const box = await start.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);

    // Mid-drag: the new length is shown and the preview sits on that frame.
    await dragBy(page, start, -60, false);
    const label = start.getByTestId('trim-label');
    await expect(label).toBeVisible();
    const midValue = await valueNow(start);
    expect(midValue).toBeLessThan(4);
    await expect(page.getByTestId('source-time-us')).toHaveText(String(Math.round(midValue * 1000)));
    // Growing the piece: the label says the new length and the gain.
    await expect(label).toHaveText(/^\d+,\d sn \(\+\d+,\d sn\)$/);
    await expect(page.getByTestId('trim-ghost')).toHaveAttribute('data-kind', 'add');
    // Nothing is stored while the pointer is still down.
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:08.000');
    await page.mouse.up();

    const trimmed = await valueNow(start);
    expect(trimmed).toBeLessThan(4);
    expect(trimmed).toBeGreaterThanOrEqual(0);
    expectOnFrameGrid(trimmed);
    await expect(ranges(page).first()).not.toHaveText('00:04.000 — 00:08.000');
    await expect(ranges(page).first()).toHaveText(/ — 00:08\.000$/);
    await expect(label).toBeHidden();
    await expect(page.getByTestId('timeline-notice')).toContainText('Parça 01 uzatıldı: 4,0 sn → ');
    const trimmedText = await ranges(page).first().textContent();

    // The whole drag is a single undo step.
    await page.getByTestId('undo').click();
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:08.000');
    await expect(page.getByTestId('moment-count')).toHaveText('2 parça');
    await page.getByTestId('redo').click();
    await expect(ranges(page).first()).toHaveText(trimmedText ?? '');

    // The second piece was never touched.
    await expect(ranges(page).nth(1)).toHaveText('00:12.000 — 00:16.000');
    expect(errors).toEqual([]);
  });

  test('dragging the end handle past the source end clamps to the source', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:18.000', '00:22.000');
    const end = page.getByTestId('trim-end');
    await dragBy(page, end, 2000);
    await expect(ranges(page).first()).toHaveText('00:18.000 — 00:24.000');
    await expect(end).toHaveAttribute('aria-valuenow', '24');
  });

  test('a drag cannot leave a piece shorter than 0.5 s, and says so', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:04.000', '00:08.000');
    await dragBy(page, page.getByTestId('trim-end'), -2000);
    // Frame grid: 4.5 s is 135 frames exactly.
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:04.500');
    await expect(page.getByTestId('timeline-notice')).toHaveText(
      'Parça 01 sürüklenerek 0,5 sn sürenin altına inemez; orada durdu: 4,0 sn → 0,5 sn · Geri al: Ctrl+Z',
    );
  });

  test('Escape during a drag cancels it and restores the preview position', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:04.000', '00:08.000');
    await seek(page, 6000);
    await expect(page.getByTestId('source-time-us')).toHaveText('6000');

    const start = page.getByTestId('trim-start');
    await dragBy(page, start, -60, false);
    expect(await valueNow(start)).toBeLessThan(4);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:08.000');
    await expect(start).toHaveAttribute('aria-valuenow', '4');
    await expect(page.getByTestId('source-time-us')).toHaveText('6000');
    await expect(page.getByTestId('trim-ghost')).toHaveCount(0);
    // No trim entry was created: one undo removes the piece itself.
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('moment-count')).toHaveText('0 parça');
  });

  test('handles are keyboard sliders: arrows move a frame, Shift a second', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:04.000', '00:08.000');

    const end = page.getByTestId('trim-end');
    await expect(end).toHaveAttribute('role', 'slider');
    await expect(end).toHaveAttribute('aria-label', 'Parça 01 bitişi');
    await end.focus();
    await expect(end).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:08.033');
    await expect(end).toHaveAttribute('aria-valuetext', '8,033 saniye');

    await page.keyboard.press('Shift+ArrowRight');
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:09.033');

    await page.keyboard.press('ArrowLeft');
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:09.000');
    await expect(end).toBeFocused();

    // Each press is its own undo step.
    await page.keyboard.press('Control+z');
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:09.033');
    await page.keyboard.press('Control+z');
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:08.033');
    await page.keyboard.press('Control+z');
    await expect(ranges(page).first()).toHaveText('00:04.000 — 00:08.000');

    // Home on the start handle goes to the source start.
    await page.getByTestId('trim-start').focus();
    await page.keyboard.press('Home');
    await expect(ranges(page).first()).toHaveText('00:00.000 — 00:08.000');
  });

  test('a trim in result mode stays in the result and parks the playhead on the cut', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:04.000', '00:08.000');
    await page.getByRole('tab', { name: 'Sonuç' }).click();
    await expect(page.getByTestId('output-note')).toBeVisible();

    await page.getByTestId('trim-start').focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(ranges(page).first()).toHaveText('00:03.000 — 00:08.000');
    // One clock (ADR-019): the result preview stays, showing the new first frame.
    await expect(page.getByRole('tab', { name: 'Sonuç' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('current-time')).toHaveText('00:00.000');
    await expect(page.getByTestId('source-time-us')).toHaveText('3000');
  });
});

test.describe('split', () => {
  test('splits the piece at the source playhead in the source preview, as one undo step', async ({ page }) => {
    const errors = await openWithSample(page);
    await addMoment(page, '00:08.000', '00:14.000');
    await expect(page.getByTestId('output-duration-us')).toHaveText('6000000');

    await seek(page, 10_000);
    await expect(page.getByTestId('split-selected')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('split-selected').click();

    await expect(page.getByTestId('moment-count')).toHaveText('2 parça');
    await expect(ranges(page)).toHaveText(['00:08.000 — 00:10.000', '00:10.000 — 00:14.000']);
    await expect(page.getByTestId('output-duration-us')).toHaveText('6000000');
    await expect(page.getByTestId('strip-clip')).toHaveCount(2);

    await page.getByTestId('undo').click();
    await expect(ranges(page)).toHaveText(['00:08.000 — 00:14.000']);
    await page.getByTestId('redo').click();
    await expect(ranges(page)).toHaveText(['00:08.000 — 00:10.000', '00:10.000 — 00:14.000']);
    expect(errors).toEqual([]);
  });

  test('S splits too, and is ignored while typing', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:08.000', '00:14.000');
    await seek(page, 12_000);

    await page.getByTestId('project-title').click();
    await page.keyboard.type('s');
    await expect(page.getByTestId('project-title')).toHaveValue('s');
    await expect(page.getByTestId('moment-count')).toHaveText('1 parça');

    await page.getByTestId('open-export').focus();
    await page.keyboard.press('s');
    await expect(ranges(page)).toHaveText(['00:08.000 — 00:12.000', '00:12.000 — 00:14.000']);
  });

  test('splitting is refused, with a reason, off every piece or too close to an edge', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:08.000', '00:14.000');
    const button = page.getByTestId('split-selected');

    // Source preview, at a source second no piece shows (the secondary flow).
    await seek(page, 3000);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('title', /hiçbir parçanın içinde değil/);
    await page.getByTestId('open-export').focus();
    await page.keyboard.press('s');
    await expect(page.getByTestId('strip-error')).toContainText('hiçbir parçanın içinde değil');
    await expect(page.getByTestId('moment-count')).toHaveText('1 parça');

    await seek(page, 8050);
    await expect(button).toHaveAttribute('title', /0,1 saniyeden yakın/);
    // aria-disabled keeps the button reachable: pressing it explains itself.
    // (Playwright's click() refuses aria-disabled elements, so use the keyboard.)
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('strip-error')).toContainText('0,1 saniyeden yakın');
    await expect(page.getByTestId('moment-count')).toHaveText('1 parça');
  });

  test('in result mode the output playhead is mapped to the right occurrence', async ({ page }) => {
    await openWithSample(page);
    await addMoment(page, '00:00.000', '00:04.000');
    await addMoment(page, '00:08.000', '00:14.000');
    // The same range again: output 5 s must still cut piece 2, not 3.
    await addMoment(page, '00:08.000', '00:14.000');

    await page.getByRole('tab', { name: 'Sonuç' }).click();
    await seek(page, 5000);
    await expect(page.getByTestId('current-time')).toHaveText('00:05.000');
    await page.getByTestId('split-selected').click();

    await expect(ranges(page)).toHaveText([
      '00:00.000 — 00:04.000',
      '00:08.000 — 00:09.000',
      '00:09.000 — 00:14.000',
      '00:08.000 — 00:14.000',
    ]);
    // The piece now under the playhead (the second half) is selected.
    await expect(page.getByTestId('strip-clip').nth(2)).toHaveAttribute('data-selected', 'true');
  });

  test('the selection never blocks a split: Böl cuts the piece under the playhead', async ({ page }) => {
    // The user test: a piece was selected, the playhead was elsewhere, and
    // "Böl" answered "Oynatma çizgisi seçili anın içinde değil".
    await openWithSample(page);
    await addMoment(page, '00:00.000', '00:04.000');
    await addMoment(page, '00:08.000', '00:14.000');
    await page.getByRole('tab', { name: 'Sonuç' }).click();

    // Select piece 1 with the keyboard (no seek to a click point) ...
    await page.getByTestId('strip-clip').first().getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('strip-clip').first()).toHaveAttribute('data-selected', 'true');
    // ... then put the playhead inside piece 2 (output 7 s = source 11 s).
    await seek(page, 7000);
    await expect(page.getByTestId('split-selected')).toHaveAttribute('aria-disabled', 'false');
    await page.getByTestId('split-selected').click();
    await expect(ranges(page)).toHaveText([
      '00:00.000 — 00:04.000',
      '00:08.000 — 00:11.000',
      '00:11.000 — 00:14.000',
    ]);
    await expect(page.getByTestId('strip-error')).toHaveCount(0);
    // No per-piece split buttons in the list: there is one "Böl".
    await expect(page.getByTestId('split-moment')).toHaveCount(0);
  });
});

test.describe('trim and split at phone width', () => {
  test('handles work with the pointer and nothing overflows', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = await openWithSample(page);
    await addMoment(page, '00:04.000', '00:08.000');

    const start = page.getByTestId('trim-start');
    await start.scrollIntoViewIfNeeded();
    const box = await start.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(24);
    await dragBy(page, start, -40);
    expect(await valueNow(start)).toBeLessThan(4);

    await seek(page, 6000);
    await page.getByTestId('split-selected').click();
    await expect(page.getByTestId('output-summary')).toContainText('2 parça');
    await expect(page.getByTestId('strip-clip')).toHaveCount(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
