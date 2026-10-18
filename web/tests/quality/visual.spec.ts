import { test } from '@playwright/test';

import { installSavePicker, noSavePicker } from '../e2e/kesitFlow';
import { isPhone, langOf } from './lib/app';
import { BUILD, writeResult } from './lib/record';
import { STATES } from './lib/states';
import { shot, type VisualEntry } from './lib/visual';

/**
 * Section 8 — visual regression: the opening screen (with its three search
 * answers), the wizard steps and the editor, at desktop and phone size,
 * against the baselines in tests/quality/baselines/.
 *
 * Every wizard's first and result screen is photographed during the
 * walkthroughs (walkthrough.spec.ts), where those screens are reached
 * anyway; this spec adds the screens the walkthroughs do not stop on.
 *
 * Moving pictures (video, canvas) and texts that depend on the clock or the
 * encoder are masked (lib/visual.ts). The editor with a video is left out
 * of the pictures on purpose: its filmstrip is drawn from decoded frames and
 * does not settle to the same pixels on every run.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(BUILD !== 'static', 'runs against the static export');

const SKIP = new Set(['editor-video', 'sihirbaz-ilk']);

for (const state of STATES.filter((item) => !SKIP.has(item.id))) {
  test(`visual: ${state.id}`, async ({ page }, testInfo) => {
    const log: VisualEntry[] = [];
    writeResult('visual', `${testInfo.project.name}.screen-${state.id}`, {
      shots: [{ name: state.id, project: testInfo.project.name, status: 'failed', note: 'ölçüm betiği yarıda kaldı (zaman aşımı ya da hata)' }],
    });
    if (isPhone(testInfo)) await noSavePicker(page);
    else await installSavePicker(page);
    try {
      await state.open(page, langOf(testInfo));
      await shot(page, testInfo, log, state.id, { mask: [page.locator('[data-testid^="size-hint-"]')] });
    } catch (error) {
      log.push({
        name: state.id,
        project: testInfo.project.name,
        status: 'failed',
        note: `ekrana ulaşılamadı: ${String((error as Error).message).split('\n')[0]?.slice(0, 200)}`,
      });
    }
    writeResult('visual', `${testInfo.project.name}.screen-${state.id}`, { shots: log });
  });
}
