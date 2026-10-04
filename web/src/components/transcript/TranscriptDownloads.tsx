'use client';

import { TEXT_MIME, saveTextFile } from '@/adapters/textFile';
import { Icon } from '@/components/Icon';
import { subtitleFileName } from '@/domain/captionFiles';
import { outputCuesForExport } from '@/domain/captions';
import type { Project } from '@/domain/edl';
import { fileBaseName, wholeVideoRecipe, type KesitSettings } from '@/domain/kesit';
import { serializeSubtitles, type SubtitleFormat } from '@/domain/subtitleFormats';
import { totalOutputDurationUs } from '@/domain/timeline';
import { transcriptText, type TranscriptLine } from '@/domain/transcript';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/**
 * "Metni indir" and "SRT / VTT indir" of the transcript result (ADR-036).
 *
 * The text file is the transcript as the panel shows it, time-stamped,
 * unclear spans included. The subtitle files are the lines as the WHOLE
 * video shows them — the same mapping the burned-in download uses
 * (`outputCues`, ADR-016) — so a player showing the SRT next to the video
 * shows what the app would burn in.
 */
export function TranscriptDownloads({
  t,
  project,
  settings,
  lines,
  videoName,
}: {
  t: T;
  project: Project;
  settings: KesitSettings;
  lines: readonly TranscriptLine[];
  videoName: string;
}) {
  const base = fileBaseName(videoName);
  const whole = wholeVideoRecipe({ ...project, clips: [] }, settings);
  const cues = whole ? outputCuesForExport(whole, totalOutputDurationUs(whole)) : [];
  const noLines = cues.length === 0;

  const saveText = () => {
    const name = subtitleFileName(`${base}_yazi`, 'srt').replace(/\.srt$/, '.txt');
    saveTextFile(name, transcriptText(lines, t('transcript.unclear'), t('transcript.file.header')), TEXT_MIME.txt);
  };
  const saveSubtitles = (format: SubtitleFormat) => {
    if (noLines) return;
    saveTextFile(subtitleFileName(`${base}_altyazi`, format), serializeSubtitles(cues, format), TEXT_MIME[format]);
  };

  return (
    <div className="transcript-downloads" data-testid="transcript-downloads">
      <button type="button" className="btn" onClick={saveText} disabled={lines.length === 0} data-testid="transcript-save-txt">
        <Icon name="download" size={16} />
        {t('transcript.file.txt')}
      </button>
      {(['srt', 'vtt'] as const).map((format) => (
        <button
          key={format}
          type="button"
          className="btn"
          onClick={() => saveSubtitles(format)}
          disabled={noLines}
          data-testid={`transcript-save-${format}`}
        >
          <Icon name="download" size={16} />
          {t(format === 'srt' ? 'transcript.file.srt' : 'transcript.file.vtt')}
        </button>
      ))}
    </div>
  );
}
