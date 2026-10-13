'use client';

import { useCallback, useMemo, useRef, useState } from 'react';


import { ownSizeRecipe } from '@/application/taskRecipes';
import { Icon } from '@/components/Icon';
import { lazyPart } from '@/components/LazyPart';
import type { CloudKeepProps } from '@/components/transcript/CloudKeep';
import type { CloudApplied, CloudRouteProps } from '@/components/transcript/CloudRoute';
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
 * "Yazıyı nerede çıkaralım?" (ADR-039): the choice between this device and
 * the internet, and the internet route itself. It exists only in a build
 * that names our proxy (`NEXT_PUBLIC_CLOUD_TRANSCRIPT_URL`); in every other
 * build — the published site among them — this is `null`, the import below
 * is removed with it, and the wizard is exactly what it was before.
 *
 * The comparison is written out here, against the literal the build inlines:
 * a flag imported from another module is not folded before the bundler
 * decides which chunks exist, and the route's chunk would be published
 * (scripts/apply-csp.mjs stops such an export).
 */
const CloudRoute = process.env.NEXT_PUBLIC_CLOUD_TRANSCRIPT === '1'
  ? lazyPart<CloudRouteProps>(() => import('@/components/transcript/CloudRoute').then((module) => module.default), { variant: 'inline' })
  : null;

/**
 * Asked for when the editor is opened over a transcript written on the
 * internet (ADR-034 addendum, 13 Oct 2026): it makes that work the browser's
 * stored project, after asking when a project is stored already. Only in a
 * build that has the route; every other build hands over as before, unsaved.
 */
const CloudKeep = process.env.NEXT_PUBLIC_CLOUD_TRANSCRIPT === '1'
  ? lazyPart<CloudKeepProps>(() => import('@/components/transcript/CloudKeep').then((module) => module.default), { close: (props) => props.onClose })
  : null;

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
  /** Cloud route only (ADR-039): what its screen asks the frame to say, and the words of a result it wrote. */
  const [cloudView, setCloudView] = useState<{ title: string | null; footer: string | null }>({ title: null, footer: null });
  const [cloud, setCloud] = useState<CloudApplied | null>(null);
  /** "Editörde aç" was pressed over a transcript written on the internet: the store is being asked, or the user is. */
  const [keeping, setKeeping] = useState(false);
  const track = primaryCaptionTrack(project);
  const transcript = track?.origin === 'transcript' ? track : undefined;
  const lines = useMemo(() => transcriptLines(transcript), [transcript]);
  const hasLines = (transcript?.cues.length ?? 0) > 0;
  const silent = video?.hasAudio === false;

  const onCloudApplied = useCallback((result: CloudApplied) => {
    // The second call of a result only adds the minutes left; it must not bring back a result that was replaced.
    setCloud((current) => (result.update && current?.jobId !== result.jobId ? current : result));
  }, []);
  const startOnDevice = () => {
    if (!video) return;
    setCloud(null);
    void transcription.start({ file: video.file, durationUs: video.durationUs, apply: state.applyTranscript });
  };

  const seek = useCallback((us: number) => {
    const element = mediaRef.current;
    if (element) element.currentTime = us / 1_000_000;
    setTimeUs(us);
  }, []);

  // The recipe carries a transcript written on the internet: opening the editor keeps it (see `CloudKeep`).
  // An on-device transcript hands over as every wizard does — unsaved (a founder decision, ADR-034 addendum).
  const keepsOnHandoff = CloudKeep !== null && cloud !== null && transcript !== undefined;

  return (
    <>
    <WizardFlow
      {...host}
      onOpenEditor={keepsOnHandoff ? () => setKeeping(true) : host.onOpenEditor}
      titleKey="wizard.yazi.title"
      chooseTitle={transcript ? null : cloudView.title}
      footerText={transcript ? (cloud?.footer ?? null) : cloudView.footer}
      fileTag="altyazili"
      downloadLabelKey="wizard.yazi.downloadVideo"
      editorNote={keepsOnHandoff ? (cloud?.keepNote ?? null) : null}
      recipe={video && hasLines ? project : null}
      working={!transcript}
      blockedText={transcript && !hasLines ? t('wizard.yazi.noLines') : null}
      preview={
        // On "Yazıyı nerede çıkaralım?" the question and its two answers are the screen (the video's name stays).
        !transcript && cloudView.title ? (
          <></>
        ) : video ? (
          <VideoPreview video={video} mediaRef={mediaRef} onTime={setTimeUs} label={t('wizard.video.label')} />
        ) : undefined
      }
      openVideo={async (file) => {
        transcription.reset();
        setCloud(null);
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
            {cloud ? (
              <p className="wizard-note" role="status" data-testid="yazi-cloud-summary">
                <Icon name="check" />
                <span>{cloud.summary}</span>
              </p>
            ) : null}
            {!cloud && transcription.job.kind === 'done' ? (
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
            {!cloud && transcription.job.kind === 'done' && transcription.job.coverage.worthSaying ? (
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
              machineNote={cloud?.machineNote}
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
            <TranscriptDownloads
              t={t}
              project={project}
              settings={state.settings}
              lines={lines}
              videoName={video.fileName}
              header={cloud?.fileHeader}
            />
            {cloud ? (
              // True until the editor is opened: nothing of this screen is stored (ADR-034).
              <p className="wizard-hint" data-testid="yazi-cloud-keep-note">
                {cloud.keepNote}
              </p>
            ) : null}
            <p className="wizard-hint">{t('wizard.yazi.editorHint')}</p>
          </>
        ) : silent ? (
          <p className="wizard-blocked" role="alert" data-testid="yazi-no-sound">
            {t('transcript.failed.no_audio')}
          </p>
        ) : (
          (() => {
            const steps = <TranscribeSteps t={t} transcription={transcription} canStart onStart={startOnDevice} />;
            // Without the cloud route (every published build): the on-device steps, as before.
            if (!CloudRoute) return steps;
            return (
              <CloudRoute
                key={video.objectUrl}
                video={video}
                transcription={transcription}
                apply={state.applyTranscript}
                deviceSteps={steps}
                startDevice={startOnDevice}
                onView={setCloudView}
                onApplied={onCloudApplied}
              />
            );
          })()
        )
      ) : null}
    </WizardFlow>
    {keeping && keepsOnHandoff && CloudKeep ? (
      <CloudKeep
        projectId={project.projectId}
        onDecide={(stored) => {
          setKeeping(false);
          host.onOpenEditor({ stored });
        }}
        onClose={() => setKeeping(false)}
      />
    ) : null}
    </>
  );
}
