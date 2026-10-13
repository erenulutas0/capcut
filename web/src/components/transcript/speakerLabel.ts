import { primaryCaptionTrack, tellsVoicesApart } from '@/domain/captions';
import type { Project } from '@/domain/edl';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/** "1. kişi", "2. kişi": a position, not a name — the first voice heard in the video is 1 (ADR-043). */
export function speakerLabel(t: T, speaker: number): string {
  return t('transcript.speaker').replace('{n}', String(speaker));
}

/**
 * The names a subtitle file may give the voices of this project's lines, or
 * nothing when the lines do not tell at least two voices apart (then no file
 * names anyone, like the panel).
 */
export function voiceNames(t: T, project: Project): ((speaker: number) => string) | undefined {
  const track = primaryCaptionTrack(project);
  if (!track || !tellsVoicesApart(track.cues)) return undefined;
  return (speaker) => speakerLabel(t, speaker);
}
