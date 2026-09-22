/**
 * ADR-019: a video that fits the output limit (60 minutes, policy v3) arrives on the
 * timeline as ONE full-length piece. The scripts here build their recipes
 * with the range flow (start/end fields, "Aralığı ekle"), so they start from
 * an empty timeline: one undo removes that piece and keeps the video open.
 * A longer video arrives with an empty timeline, and nothing is undone.
 */
export async function emptyTimeline(page) {
  if ((await page.getByTestId('strip-clip').count()) === 0) return;
  await page.getByTestId('undo').click();
  await page.getByTestId('range-start').waitFor();
}
