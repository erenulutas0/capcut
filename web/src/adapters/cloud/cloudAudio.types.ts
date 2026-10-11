/** Message contract between the page and the cloud-audio worker (ADR-039). */

export type CloudAudioFailure =
  /** The video has no sound track (or an empty one). */
  | 'no_audio'
  | 'undecodable'
  | 'unreadable'
  /** This browser has neither an Opus nor an AAC encoder. */
  | 'encoder_unavailable'
  | 'internal_error';

export interface CloudAudioRequest {
  type: 'extract';
  requestId: string;
  file: File;
  /** Test builds only (`CLIP_TEST_HOOKS=1`): use this encoder or fail. Ignored in every other build. */
  testCodec?: 'opus' | 'aac' | 'none';
}

export type CloudAudioResponse =
  /** Seconds of the video's sound encoded so far, of its length. */
  | { type: 'progress'; requestId: string; doneS: number; totalS: number }
  | { type: 'done'; requestId: string; buffer: ArrayBuffer; mime: 'audio/webm' | 'audio/mp4'; codec: 'opus' | 'aac'; durationS: number }
  | { type: 'failed'; requestId: string; reason: CloudAudioFailure };
