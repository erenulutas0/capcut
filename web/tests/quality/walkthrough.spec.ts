import { test } from '@playwright/test';

import { BUILD, writeResult } from './lib/record';
import { FLOWS, YAZI_PUBLISHED, blankResult, walk, type WalkResult } from './lib/walk';
import type { VisualEntry } from './lib/visual';

/**
 * Section 1 — task-completion walkthroughs on the build people get (the
 * static export). Nine cards end with a real file; "Yazıya dök" is walked as
 * far as the model download (its complete flow, with a stand-in recogniser,
 * is in walkthrough-yazi.spec.ts and is labelled as such in the report).
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'static', 'runs against the static export (the runner sets QUALITY_BUILD=static)');

for (const flow of [...FLOWS, YAZI_PUBLISHED]) {
  test(`walkthrough: ${flow.id}`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const visual: VisualEntry[] = [];
    writeResult('walkthrough', `${testInfo.project.name}.${flow.id}`, { tasks: [blankResult(testInfo, flow, 'ölçüm betiği yarıda kaldı (zaman aşımı)')] });
    const result: WalkResult = await walk(page, testInfo, flow, visual);
    // One file per task: a task that goes wrong does not take the others' numbers with it.
    writeResult('walkthrough', `${testInfo.project.name}.${flow.id}`, { tasks: [result] });
    writeResult('visual', `${testInfo.project.name}.walkthrough-${flow.id}`, { shots: visual });
  });
}
