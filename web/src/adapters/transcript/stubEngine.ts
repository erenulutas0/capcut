/// <reference lib="webworker" />

/**
 * TEST DOUBLE — not the recogniser. A scripted stand-in the UI tests run
 * through the real worker protocol (`CLIP_TEST_HOOKS=1` builds only): it
 * opens the video's sound exactly as the real engine does (so "no sound" is
 * the real refusal), then posts the segments the test supplied, one by one.
 * It hears nothing and writes nothing of its own.
 *
 * It is imported behind a build-time constant in `transcriptWorker.ts`; the
 * published site is built without it, and `scripts/apply-csp.mjs` refuses to
 * finish a static export that contains the marker below.
 */

import { AudioFeedError, openAudio } from './audioFeed';
import { EngineError, type EngineSink } from './engine.types';
import type { StubScript, TranscribeStats } from './protocol';
import type { TranscriptModelId } from '@/domain/transcriptModels';
import { US_PER_SECOND } from '@/domain/time';

/** Looked for in the published files by the build and by the Pages smoke test. */
export const STUB_MARKER = 'clip-transcript-stub-engine';

export async function runStubTranscription(
  file: File,
  model: TranscriptModelId,
  script: StubScript,
  sink: EngineSink,
): Promise<TranscribeStats> {
  const started = performance.now();
  // Said out loud in the console, and the string the publish check looks for.
  console.info(STUB_MARKER);
  let audio;
  try {
    audio = await openAudio(file);
  } catch (error) {
    throw new EngineError(error instanceof AudioFeedError ? error.reason : 'unreadable');
  }
  const audioUs = Math.round(audio.durationS * US_PER_SECOND);
  audio.input.dispose();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const stepMs = script.stepMs ?? 0;

  sink.progress({ phase: 'loading' });
  await wait(stepMs);
  sink.progress({ phase: 'listening', doneUs: 0, totalUs: audioUs });
  await wait(stepMs);
  sink.progress({ phase: 'listening', doneUs: audioUs, totalUs: audioUs });
  sink.progress({ phase: 'writing', spansDone: 0, spansTotal: script.segments.length });
  let done = 0;
  for (const segment of script.segments) {
    await wait(stepMs);
    sink.segment(segment);
    done += 1;
    sink.progress({ phase: 'writing', spansDone: done, spansTotal: script.segments.length });
    if (script.failWith && done === 1) throw new EngineError(script.failWith);
  }
  return {
    model,
    device: 'stub',
    audioUs,
    speechUs: script.segments.reduce((sum, segment) => sum + (segment.endUs - segment.startUs), 0),
    spans: script.segments.length,
    unclearSpans: script.segments.filter((segment) => segment.state === 'unclear').length,
    loadMs: 0,
    listenMs: 0,
    writeMs: 0,
    totalMs: Math.round(performance.now() - started),
  };
}
