/**
 * What the recogniser and its test stand-in share, in a file of its own so
 * that neither has to import the other (the real engine pulls in
 * Transformers.js; the stand-in must not).
 */

import type { TranscriptSegment } from '@/domain/transcript';
import type { TranscribeFailure, TranscribeProgress } from './protocol';

export class EngineError extends Error {
  constructor(readonly reason: TranscribeFailure) {
    super(reason);
    this.name = 'EngineError';
  }
}

export interface EngineSink {
  progress(progress: TranscribeProgress): void;
  segment(segment: TranscriptSegment): void;
}
