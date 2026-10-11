'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { ownSizeRecipe } from '@/application/taskRecipes';
import { Icon } from '@/components/Icon';
import { TranscribeSteps } from '@/components/transcript/TranscribeSteps';
import { TranscriptDownloads } from '@/components/transcript/TranscriptDownloads';
import { TranscriptPanel } from '@/components/transcript/TranscriptPanel';
import { useTranscription } from '@/components/transcript/useTranscription';
import { primaryCaptionTrack } from '@/domain/captions';
import { transcriptLines } from '@/domain/transcript';
import { RECOMMENDED_MODEL } from '@/domain/transcriptModels';
import { translator, type MessageKey } from '@/i18n/messages';
import { VideoPreview, WizardFlow, fill, lengthText, type WizardHostProps } from './WizardFlow';

const t = translator('tr');

/**
 * "Yazıya dök" (ADR-036): the video's English speech as time-stamped text,
 * written on this device. The model is downloaded once, by an explicit
 * button that says its size; then "Yazıya dök" runs with real progress.
 *
 * The result is the transcript panel next to the video — click a line to
 * jump there, fix a wrong word in place — and four ways out: the video with
 * the lines burned in ("Altyazılı videoyu indir", the wizard's download),
 * the text, the SRT/VTT files, or the editor, where lines become kesitler.
 */
export default function YaziWizard(host: WizardHostProps) {
  const { state } = host;
  const { video, project } = state;
  const transcription = useTranscription();
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const [timeUs, setTimeUs] = useState(0);
  const track = primaryCaptionTrack(project);
  const transcript = track?.origin === 'transcript' ? track : undefined;
  const lines = useMemo(() => transcriptLines(transcript), [transcript]);
  const hasLines = (transcript?.cues.length ?? 0) > 0;
  const silent = video?.hasAudio === false;

  const seek = useCallback((us: number) => {
    const element = mediaRef.current;
    if (element) element.currentTime = us / 1_000_000;
    setTimeUs(us);
  }, []);

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.yazi.title"
      fileTag="altyazili"
      downloadLabelKey="wizard.yazi.downloadVideo"
      recipe={video && hasLines ? project : null}
      working={!transcript}
      blockedText={transcript && !hasLines ? t('wizard.yazi.noLines') : null}
      preview={
        video ? <VideoPreview video={video} mediaRef={mediaRef} onTime={setTimeUs} label={t('wizard.video.label')} /> : undefined
      }
      openVideo={async (file) => {
        transcription.reset();
        const outcome = await state.importVideo(file, ownSizeRecipe);
        if (outcome.kind !== 'opened') return false;
        // The video's own frame: nothing of the picture is cut off.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        setTimeUs(0);
        return true;
      }}
    >
      {video ? (
        transcript ? (
          <>
            {transcription.job.kind === 'done' ? (
              <p className="wizard-note" role="status" data-testid="yazi-summary">
                <Icon name="check" />
                <span>
                  {fill(t('wizard.yazi.done'), {
                    lines: String(transcription.job.lines),
                    time: lengthText(transcription.job.stats.totalMs * 1000),
                  })}
                  {transcription.job.skipped > 0
                    ? ` ${fill(t('wizard.yazi.skipped'), { n: String(transcription.job.skipped) })}`
                    : ''}
                </span>
              </p>
            ) : null}
            {transcription.job.kind === 'done' && transcription.job.coverage.worthSaying ? (
              // Plainly: how much of the speech became text. Not a warning that the user did something wrong.
              <div className="wizard-panel" data-testid="yazi-coverage">
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
                        // Back to the step before, with the recommended model selected. Nothing downloads by
                        // itself: the step shows "Modeli indir" with its size, or "Yazıya dök" when it is here.
                        transcription.chooseModel(RECOMMENDED_MODEL);
                        transcription.reset();
                        state.undo();
                      }}
                      data-testid="yazi-try-larger"
                    >
                      {t('transcript.coverage.tryLarger')}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            <TranscriptPanel
              t={t}
              headingId="yazi-transcript-title"
              lines={lines}
              timeUs={timeUs}
              videoDurationUs={video.durationUs}
              machineMade
              onSeek={seek}
              onEdit={(cueId, text) => {
                const result = state.updateCaption(cueId, { text });
                return result.ok ? { ok: true } : { ok: false, reason: t(`captions.error.${result.reason}` as MessageKey) };
              }}
              onWriteUnclear={(range, text) => {
                const result = state.addCaption({ ...range, text });
                return result.ok ? { ok: true } : { ok: false, reason: t(`captions.error.${result.reason}` as MessageKey) };
              }}
            />
            <TranscriptDownloads t={t} project={project} settings={state.settings} lines={lines} videoName={video.fileName} />
            <p className="wizard-hint">{t('wizard.yazi.editorHint')}</p>
          </>
        ) : silent ? (
          <p className="wizard-blocked" role="alert" data-testid="yazi-no-sound">
            {t('transcript.failed.no_audio')}
          </p>
        ) : (
          <TranscribeSteps
            t={t}
            transcription={transcription}
            canStart
            onStart={() =>
              void transcription.start({
                file: video.file,
                durationUs: video.durationUs,
                apply: state.applyTranscript,
              })
            }
          />
        )
      ) : null}
    </WizardFlow>
  );
}
