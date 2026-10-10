/**
 * The four calls to the provider (AssemblyAI). Endpoints and shapes as
 * documented on 2026-10-10 — links in cloud/harness/lib/provider.mjs.
 *
 * The key is sent only to the provider's own host (config.providerBase) and is
 * never put into an error message, a response or a log.
 */

export class UpstreamError extends Error {
  constructor(
    readonly step: 'upload' | 'create' | 'status' | 'result' | 'delete',
    readonly status: number,
  ) {
    super(`provider ${step} failed with HTTP ${status}`);
  }
}

/** Above this size a transcript object can only be a finished one (queued / processing / error objects carry no words). */
const SMALL_BODY_CHARS = 16 * 1024;

/** Streams the audio to the provider. `body` is passed through; it is never collected in memory. */
export async function uploadAudio(base: string, key: string, body: ReadableStream<Uint8Array>): Promise<string> {
  const response = await fetch(`${base}/v2/upload`, {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/octet-stream' },
    body,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError('upload', response.status);
  }
  const json = (await response.json()) as { upload_url?: unknown };
  if (typeof json.upload_url !== 'string') throw new UpstreamError('upload', 502);
  return json.upload_url;
}

export interface TranscriptRequest {
  audioUrl: string;
  speechModels: string[];
  language: string; // "auto" or a language code
  speakerLabels: boolean;
  /** Only this much of the file is transcribed (ms): the declared length, so a longer file gains nothing. */
  audioEndAtMs: number;
}

export async function createTranscript(base: string, key: string, request: TranscriptRequest): Promise<string> {
  const params: Record<string, unknown> = {
    audio_url: request.audioUrl,
    speech_models: request.speechModels,
    punctuate: true,
    format_text: true,
    audio_end_at: request.audioEndAtMs,
  };
  if (request.language === 'auto') params.language_detection = true;
  else params.language_code = request.language;
  if (request.speakerLabels) params.speaker_labels = true;
  const response = await fetch(`${base}/v2/transcript`, {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError('create', response.status);
  }
  const json = (await response.json()) as { id?: unknown };
  if (typeof json.id !== 'string') throw new UpstreamError('create', 502);
  return json.id;
}

export interface TranscriptStatus {
  status: 'queued' | 'processing' | 'completed' | 'error';
  audioDurationS: number | null;
}

/**
 * Status of a transcript WITHOUT parsing a finished one: a finished transcript
 * of a two-hour file is megabytes of JSON, and parsing that would spend the
 * Free plan's 10 ms of CPU per request. Small bodies are parsed normally; a
 * large body is a finished transcript and only its `audio_duration` is picked
 * out with a native search.
 */
export async function getTranscriptStatus(base: string, key: string, transcriptId: string): Promise<TranscriptStatus> {
  const response = await fetch(`${base}/v2/transcript/${encodeURIComponent(transcriptId)}`, { headers: { authorization: key } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError('status', response.status);
  }
  const text = await response.text();
  if (text.length <= SMALL_BODY_CHARS) {
    const json = JSON.parse(text) as { status?: string; audio_duration?: number | null };
    if (json.status !== 'queued' && json.status !== 'processing' && json.status !== 'completed' && json.status !== 'error') throw new UpstreamError('status', 502);
    return { status: json.status, audioDurationS: typeof json.audio_duration === 'number' ? json.audio_duration : null };
  }
  const match = /"audio_duration"\s*:\s*(\d+(?:\.\d+)?)/.exec(text);
  return { status: 'completed', audioDurationS: match ? Number(match[1]) : null };
}

/** The finished transcript as the provider sends it; the caller streams the body on without reading it. */
export async function fetchResult(base: string, key: string, transcriptId: string): Promise<Response> {
  const response = await fetch(`${base}/v2/transcript/${encodeURIComponent(transcriptId)}`, { headers: { authorization: key } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError('result', response.status);
  }
  return response;
}

/** Removes the transcript and, with it, the uploaded audio at the provider. A 404 means it is already gone. */
export async function deleteTranscript(base: string, key: string, transcriptId: string): Promise<void> {
  const response = await fetch(`${base}/v2/transcript/${encodeURIComponent(transcriptId)}`, { method: 'DELETE', headers: { authorization: key } });
  await response.body?.cancel();
  if (!response.ok && response.status !== 404) throw new UpstreamError('delete', response.status);
}
