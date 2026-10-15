'use client';

import { useState } from 'react';

import type { MediaHandle } from '@/adapters/browserMedia';
import { Icon } from '@/components/Icon';
import { TranscribeSteps } from '@/components/transcript/TranscribeSteps';
import { useTranscription, type TranscriptionTarget } from '@/components/transcript/useTranscription';
import type { CaptionStyleV2 } from '@/domain/edl';
import { RECOMMENDED_MODEL } from '@/domain/transcriptModels';
import type { MessageKey } from '@/i18n/messages';
import { Dialog } from './Dialog';

/** Fills `{name}` slots; values are inserted literally. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * "Videoyu yazıya dök" in the editor (ADR-036): the dialog with the model step and the progress.
 *
 * Its code, and the questions it asks this browser (which models are stored, whether the large one can
 * run), come with the first press of "Yazıya dök", not with the editor (15 Oct 2026: the editor's
 * blocking time at load). The editor keeps it mounted from then on, open or closed, so a model download
 * goes on behind a closed dialog as before. Each press of "Yazıya dök" (`session`) starts it from its
 * first step.
 */
export function EditorTranscribe({
  t,
  open,
  session,
  video,
  captionStyle,
  hasCaptions,
  apply,
  onClose,
  onDone,
}: {
  t: (key: MessageKey) => string;
  open: boolean;
  session: number;
  video: MediaHandle | null;
  captionStyle: CaptionStyleV2;
  hasCaptions: boolean;
  apply: TranscriptionTarget['apply'];
  onClose: () => void;
  onDone: () => void;
}) {
  const transcription = useTranscription();
  const [seenSession, setSeenSession] = useState(session);
  if (seenSession !== session) {
    // A new press of "Yazıya dök": as the button itself did before this dialog had its own file,
    // whatever ran is stopped and the dialog starts from its first step, in the same render that opens it.
    setSeenSession(session);
    transcription.reset();
  }

  if (!video) return null;
  const close = () => {
    // Closing stops a transcription (nothing partial is kept); a model download keeps what it has.
    transcription.cancel();
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} labelledBy="transcribe-title">
      <div className="dialog-head">
        <h2 id="transcribe-title">{t('transcript.dialog.title')}</h2>
        <button type="button" className="icon-btn" onClick={close} aria-label={t('help.close')}>
          <Icon name="close" />
        </button>
      </div>
      {transcription.job.kind === 'done' ? (
        <>
          <p className="wizard-note" role="status" data-testid="transcribe-done">
            <Icon name="check" />
            <span>{fill(t('transcript.dialog.done'), { lines: String(transcription.job.lines) })}</span>
          </p>
          {transcription.job.coverage.worthSaying ? (
            <div className="wizard-panel" data-testid="transcribe-coverage">
              <p className="wizard-panel-title" role="status">
                {fill(t('transcript.coverage'), {
                  pct: String(transcription.job.coverage.writtenPercent),
                  n: String(transcription.job.coverage.unclearCount),
                })}
              </p>
              {transcription.job.suggestLarger ? (
                <>
                  <p className="wizard-hint">{t('transcript.coverage.larger')}</p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      // The same dialog, one step back, with the recommended model selected; nothing downloads by itself.
                      transcription.chooseModel(RECOMMENDED_MODEL);
                      transcription.reset();
                    }}
                    data-testid="transcribe-try-larger"
                  >
                    {t('transcript.coverage.tryLarger')}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="btn btn-accent" onClick={onDone} data-testid="transcribe-close">
              {t('transcript.dialog.close')}
            </button>
          </div>
        </>
      ) : video.hasAudio === false ? (
        <p className="wizard-blocked" role="alert" data-testid="transcribe-no-sound">
          {t('transcript.failed.no_audio')}
        </p>
      ) : (
        <TranscribeSteps
          t={t}
          transcription={transcription}
          canStart
          replaceNote={hasCaptions ? t('transcript.dialog.replace') : null}
          onStart={() =>
            void transcription.start({
              file: video.file,
              durationUs: video.durationUs,
              style: captionStyle,
              apply,
            })
          }
        />
      )}
    </Dialog>
  );
}
