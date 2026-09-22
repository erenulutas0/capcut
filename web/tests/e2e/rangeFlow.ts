import { expect, type Page } from '@playwright/test';

/**
 * ADR-019: an opened video that fits the output limit arrives on the
 * timeline as ONE full-length piece (its own undo step on top of the import).
 *
 * Many older tests exercise the secondary range flow ("Kaynak" preview,
 * start/end fields, "Aralığı ekle") and count pieces from zero. They start
 * from an empty timeline the way a user would: one undo removes the automatic
 * piece and keeps the video open.
 */
export async function startWithEmptyTimeline(page: Page): Promise<void> {
  await expect(page.getByTestId('strip-clip')).toHaveCount(1);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('strip-clip')).toHaveCount(0);
  await expect(page.getByTestId('range-start')).toBeVisible();
}
