import { expect, test } from '@playwright/test';

import { FLOWS, YAZI_PUBLISHED } from '../quality/lib/walk';
import { walkCard } from './lib/cardWalk';
import { writeCell } from './lib/cells';

/**
 * Every card of the opening screen, in every engine and size of
 * playwright.browsers.config.ts, with a small generated or bundled test
 * video. The result of each walk is written down (the table of
 * docs/quality/browsers-latest.md) and one thing is required of it: it is
 * never "broken". A browser that cannot do the job is fine — as long as the
 * user is told so in words and nothing pretends to have worked.
 */

test.use({ storageState: { cookies: [], origins: [] } });

for (const flow of [...FLOWS, YAZI_PUBLISHED]) {
  test(`kart: ${flow.id}`, async ({ page }, testInfo) => {
    // A run cut short by the test's own timeout still leaves a row that says so.
    writeCell({
      area: 'card',
      id: flow.id,
      project: testInfo.project.name,
      verdict: 'broken',
      summary: 'betik yarıda kaldı (zaman aşımı): bu satır bir ölçüm değil',
    });
    const cell = await walkCard(page, testInfo, flow);
    writeCell(cell);
    expect(cell.verdict, `${cell.summary}\n${cell.text ?? ''}`).not.toBe('broken');
    if (cell.verdict === 'refusal') expect(cell.text ?? '', 'a refusal has words').not.toBe('');
    // "Bu tarayıcı video dosyası hazırlayamıyor" beside a file that was made would be the opposite lie.
    if (cell.verdict === 'works') expect(cell.facts?.noticeBeforeDownload ?? '', 'no "cannot" notice on a task that worked').toBe('');
  });
}
