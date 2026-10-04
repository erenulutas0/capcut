import { describe, expect, it } from 'vitest';

import { addClip, applyTranscriptTrack, createEmptyProject, setVideoAsset } from '@/application/commands';
import { preflightCaptions } from '@/domain/captionBurnIn';
import type { MeasureText } from '@/domain/captionLayout';
import { CAPTION_LIMITS, DEFAULT_CAPTION_STYLE, captionAtVideoTime, outputCues, videoCues } from '@/domain/captions';
import type { AssetV1, Project } from '@/domain/edl';
import { loadProject } from '@/domain/migration';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { US_PER_SECOND } from '@/domain/time';
import { activeLineIndex, transcriptLines } from '@/domain/transcript';

/**
 * What the higher line limit costs (ADR-036 "Satır sınırı"): the limit went
 * from 500 to 3000 lines so that a two-hour talk fits. These are the places
 * that walk every line — measured here at the limit, with generous ceilings
 * so the test says "this stayed cheap", and the measured figures printed for
 * the ADR (`CAPTION-LIMIT {…}`).
 */

const S = US_PER_SECOND;
const LIMIT = CAPTION_LIMITS.maxCuesPerTrack;
const video: AssetV1 = { assetId: 'a_video_001', kind: 'video', durationUs: 120 * 60 * S, displayWidth: 1920, displayHeight: 1080, hasAudio: true };

/** A two-hour video with a line every 2.4 s: 3000 two-line cues, and 20 kesitler of 3 minutes. */
function fullProject(): Project {
  let project = setVideoAsset(createEmptyProject(), video);
  for (let index = 0; index < 20; index += 1) {
    const result = addClip(project, { sourceInUs: index * 6 * 60 * S, sourceOutUs: index * 6 * 60 * S + 3 * 60 * S });
    if (!result.ok) throw new Error(result.reason);
    project = result.project;
  }
  const cues = Array.from({ length: LIMIT }, (_, index) => ({
    startUs: index * 2_400_000,
    endUs: index * 2_400_000 + 2_200_000,
    text: `These were French people ${index}\nwho had made peace with the`,
  }));
  const applied = applyTranscriptTrack(project, cues, []);
  if (!applied.ok) throw new Error('apply failed');
  expect(applied.report.imported).toBe(LIMIT);
  return applied.project;
}

const measure: MeasureText = (text, fontPx) => Array.from(text).length * fontPx * 0.56;

function timed<T>(run: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

describe('3000 caption lines: what walking them costs', () => {
  it('stays cheap everywhere a frame, an edit or a save touches every line', () => {
    const project = fullProject();

    // Validation: every stored and restored recipe goes through it.
    const validation = timed(() => loadProject(project));
    expect(validation.value.ok).toBe(true);

    // The output view (preview lane, SRT/VTT, render plan): 20 kesitler × 3000 lines.
    const output = timed(() => outputCues(project));
    expect(output.value.length).toBeGreaterThan(1000);

    // The render plan of the joined download (60 minutes of output, 30 fps).
    const plan = timed(() => compileRenderPlan(project, WEB_LOCAL_POLICY));
    expect(plan.value.ok).toBe(true);
    if (!plan.value.ok) return;
    const captions = plan.value.plan.captions;
    expect(captions).toBeDefined();

    // Export preflight: every line laid out once before the first frame.
    const preflight = timed(() => preflightCaptions(captions!, { width: 1920, height: 1080, aspect: '16:9' }, measure));
    expect(preflight.value.ok).toBe(true);

    // The preview's question on every time update: which line is on screen now?
    const lookups = 200;
    const atVideoTime = timed(() => {
      for (let index = 0; index < lookups; index += 1) captionAtVideoTime(project, index * 36 * S, null);
    });
    const marks = timed(() => videoCues(project));
    expect(marks.value).toHaveLength(LIMIT);

    // The transcript panel: its list, and the active line (binary search) per time update.
    const lines = timed(() => transcriptLines(project.captionTracks[0]));
    expect(lines.value).toHaveLength(LIMIT);
    const active = timed(() => {
      for (let index = 0; index < 10_000; index += 1) activeLineIndex(lines.value, (index * 7_200 * S) / 10_000);
    });

    // What is stored (IndexedDB, the backup file).
    const json = JSON.stringify(project);

    const figures = {
      lines: LIMIT,
      validateMs: Number(validation.ms.toFixed(1)),
      outputCuesMs: Number(output.ms.toFixed(1)),
      outputCueCount: output.value.length,
      renderPlanMs: Number(plan.ms.toFixed(1)),
      renderPlanCues: captions!.cues.length,
      preflightMs: Number(preflight.ms.toFixed(1)),
      captionAtVideoTimeMsPerCall: Number((atVideoTime.ms / lookups).toFixed(3)),
      videoCuesMs: Number(marks.ms.toFixed(1)),
      transcriptLinesMs: Number(lines.ms.toFixed(1)),
      activeLineUsPerCall: Number(((active.ms / 10_000) * 1000).toFixed(2)),
      recipeJsonBytes: json.length,
    };
    console.log(`CAPTION-LIMIT ${JSON.stringify(figures)}`);

    // Ceilings far above what was measured: a regression to quadratic work fails here.
    expect(validation.ms).toBeLessThan(500);
    expect(output.ms).toBeLessThan(500);
    expect(plan.ms).toBeLessThan(1000);
    expect(preflight.ms).toBeLessThan(1000);
    expect(atVideoTime.ms / lookups).toBeLessThan(10);
    expect(active.ms / 10_000).toBeLessThan(0.05);
    expect(json.length).toBeLessThan(1_000_000);
  });
});
