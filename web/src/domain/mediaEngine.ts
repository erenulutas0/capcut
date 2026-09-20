/**
 * MediaEngine port (doc 10 "Motor portu") — a behaviour contract.
 *
 * W1 implements it for the browser with WebCodecs + Mediabunny
 * (`src/adapters/export/`). The capability report and export event types live
 * next to their own concerns (`exportEvents.ts`, `adapters/exportCapability.ts`)
 * so the domain never depends on a specific encoder.
 */

import type { ProjectV1 } from './edl';
import type { ExportEvent } from './exportEvents';
import type { ExportPolicy } from './policy';
import type { RenderPlan } from './renderPlan';
import type { Micros } from './time';

export interface ProbeResult {
  durationUs: Micros;
  /** Orientation-corrected display size, when the platform reports it. */
  displayWidth?: number;
  displayHeight?: number;
  /**
   * `undefined` means "the platform did not tell us", not "there is no audio".
   * Browsers do not expose track lists reliably from a media element, so the
   * editor shows "unknown" rather than guessing. The export path asks the
   * demuxer instead, which does know.
   */
  hasAudio?: boolean;
  mimeType: string;
  sizeBytes: number;
}

export interface MediaEngine {
  probe(file: File): Promise<ProbeResult>;
  /** Compiles the recipe and reports whether this environment can run it. */
  assess(project: ProjectV1, policy: ExportPolicy): Promise<{ plan: RenderPlan | null; canExport: boolean }>;
  /** Emits exactly one terminal event: succeeded, failed or canceled. */
  export(plan: RenderPlan, videoFile: File, audioFile: File | null): AsyncIterable<ExportEvent>;
  cancel(): void;
  dispose(): void;
}
