/**
 * ADR-019/ADR-021: every video that opens (up to the 120-minute input limit,
 * policy v4) arrives on the timeline as ONE full-length piece, even when it
 * is longer than the output limit. The scripts here build their recipes with
 * the range flow (start/end fields, "Aralığı ekle"), so they start from an
 * empty timeline: one undo removes that piece and keeps the video open.
 */
export async function emptyTimeline(page) {
  if ((await page.getByTestId('strip-clip').count()) === 0) return;
  await page.getByTestId('undo').click();
  await page.getByTestId('range-start').waitFor();
}
