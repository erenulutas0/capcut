'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { CapabilityReportV1 } from '@/adapters/exportCapability';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import { Icon, Wordmark } from '@/components/Icon';
import { DownloadStatus } from '@/components/editor/DownloadStatus';
import { MediaErrorNotice } from '@/components/editor/MediaErrorNotice';
import { ReportDialog } from '@/components/editor/ReportDialog';
import type { ExportExtras, TargetSizePreview } from '@/components/editor/useDownloads';
import type { EditorState } from '@/components/editor/useEditorState';
import { useLayoutMode } from '@/components/editor/useLayoutMode';
import { useTouchScreen } from '@/components/editor/useTouchScreen';
import { useHydrated } from '@/components/useHydrated';
import type { Project } from '@/domain/edl';
import type { TargetSizeRequest } from '@/domain/targetSize';
import type { TaskDefinition } from '@/domain/tasks';
import { formatLengthShort } from '@/domain/time';
import { translator, type MessageKey } from '@/i18n/messages';
import { useWizardExport } from './useWizardExport';

const t = translator('tr');

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function lengthText(us: number): string {
  return formatLengthShort(us, { second: t('time.secondShort'), decimalMark: t('time.decimalMark') });
}

/** What every wizard gets from the route (`TaskWizard`). */
export interface WizardHostProps {
  task: TaskDefinition;
  /** The recipe and the open files: the same state the editor works on. */
  state: EditorState;
  /** Shows the editor over this very state: same video, same settings, no second file dialog. */
  onOpenEditor: () => void;
}

/** What the choose step may want to know about the export side. */
export interface FlowInfo {
  /** The capability check of the open video, once it finished (codecs, HDR). */
  capability: CapabilityReportV1 | null;
  /** A download is running: choices must not change under it. */
  busy: boolean;
  /** "Küçült" (ADR-035): what a download at this size would be, before anything is encoded. */
  previewSize: (target: TargetSizeRequest) => Promise<TargetSizePreview>;
}

interface Props extends WizardHostProps {
  /** Opens the picked file and prepares the recipe; false when the file was refused. */
  openVideo: (file: File) => Promise<boolean>;
  /** The choose step's heading ("Dikey yapalım"). */
  titleKey: MessageKey;
  /** The end of the suggested file name: "tatil_dikey.mp4". */
  fileTag: string;
  /** The recipe "İndir" encodes, the choice applied; null while there is nothing to download. */
  recipe: Project | null;
  audioFile?: File | null;
  /** Extra options for the export request (see `useWizardExport`). */
  exportExtras?: ExportExtras;
  /** The step is still preparing (an analysis runs): no "İndir" and no editor link yet. */
  working?: boolean;
  /** Why "İndir" cannot be pressed yet, said above it. */
  blockedText?: string | null;
  /** Instead of the standard preview (Dikey yap shows the 9:16 frame). */
  preview?: ReactNode;
  /** Puts the wizard's own result into the recipe before the editor opens over it. */
  beforeEditor?: () => void;
  /** The download button's words when "İndir" alone would not say what is saved ("Altyazılı videoyu indir"). */
  downloadLabelKey?: MessageKey;
  /** The one decision (or the one-line explanation) of this task. */
  children: ReactNode | ((info: FlowInfo) => ReactNode);
}

type Step = 'pick' | 'choose' | 'result';

/**
 * The frame every task wizard shares (ADR-034):
 *
 * 1. "Videonu seç": one big button (drag and drop on a desktop), with the
 *    editor's own refusals (too large, too long, cannot be read).
 * 2. The task's one decision, a default already chosen, and "İndir".
 * 3. Progress → "Kaydedildi" + "Paylaş", through the editor's download hook.
 *
 * A small preview of the video, a way back and "Daha fazla ayar → editörde
 * aç" are on every step after the first. Focus moves to the step's heading
 * when the step changes. Nothing is stored: no project is saved from here.
 */
export function WizardFlow({
  task,
  state,
  onOpenEditor,
  openVideo,
  titleKey,
  fileTag,
  recipe,
  audioFile = null,
  exportExtras,
  working = false,
  blockedText = null,
  preview,
  beforeEditor,
  downloadLabelKey = 'wizard.download',
  children,
}: Props) {
  const hydrated = useHydrated();
  const phone = useLayoutMode() === 'phone';
  const touchScreen = useTouchScreen();
  const { video } = state;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  /** "Geri" on the choose step, or "Başka bir video": the pick step again, the old video still open behind it. */
  const [picking, setPicking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const exporter = useWizardExport({
    project: recipe ?? state.project,
    settings: state.settings,
    videoFile: video?.file ?? null,
    videoName: video?.fileName ?? null,
    audioFile,
    fileTag,
    extras: exportExtras,
  });
  const { entry, busy } = exporter;

  const step: Step = !video || picking ? 'pick' : entry ? 'result' : 'choose';
  const totalSteps = task.steps.includes('editor') ? 2 : 3;
  const stepNumber = step === 'pick' ? 1 : step === 'choose' ? 2 : 3;
  const importing = state.importing === 'video';

  // Focus follows the step: its heading, so a screen reader hears where it is.
  const previousStep = useRef<Step>(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const pick = async (file: File) => {
    if (busy) return;
    exporter.dismiss();
    const opened = await openVideo(file);
    if (opened) setPicking(false);
  };
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });

  // A file dropped anywhere on the pick step opens; dropped anywhere else it
  // must not make the browser leave the page to play it.
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (step === 'pick') setDragOver(true);
    };
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragOver(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files[0];
      if (file && step === 'pick') void pickRef.current(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [step]);

  /** Leaving while a download runs would stop it: ask first, as the browser does on reload. */
  const guardLeave = (event: React.MouseEvent) => {
    if (busy && !window.confirm(t('wizard.leaveWarning'))) event.preventDefault();
  };

  const back = () => {
    if (step === 'result') {
      if (busy) {
        if (window.confirm(t('wizard.leaveWarning'))) exporter.cancel();
        return;
      }
      exporter.dismiss();
      return;
    }
    setPicking(true);
  };

  const openEditor = () => {
    if (busy) return;
    beforeEditor?.();
    onOpenEditor();
  };

  const title =
    step === 'pick'
      ? t('wizard.pick.title')
      : step === 'choose' || !entry
        ? t(titleKey)
        : entry.phase === 'running'
          ? t('wizard.result.running')
          : entry.phase === 'saved'
            ? t('wizard.result.saved')
            : entry.phase === 'ready'
              ? t(entry.result.output === 'audio' ? 'wizard.result.readyAudio' : 'wizard.result.ready')
              : entry.phase === 'canceled'
                ? t('wizard.result.canceled')
                : t('wizard.result.failed');

  const finished = entry?.phase === 'saved' || entry?.phase === 'ready';
  const moreSettings =
    video && !working && !busy ? (
      <button type="button" className="link-button wizard-more" onClick={openEditor} data-testid="wizard-open-editor">
        {t('wizard.moreSettings')}
      </button>
    ) : null;

  return (
    <div className="wizard" data-step={step} data-task={task.id} data-testid="wizard">
      <header className="wizard-bar">
        {step === 'pick' ? (
          <Link href="/" prefetch={false} className="wizard-back" onClick={guardLeave} data-testid="wizard-back">
            <Icon name="back" />
            {t('wizard.back')}
          </Link>
        ) : (
          <button type="button" className="wizard-back" onClick={back} data-testid="wizard-back">
            <Icon name="back" />
            {t('wizard.back')}
          </button>
        )}
        <Link
          href="/"
          prefetch={false}
          className="wordmark-link"
          aria-label={t('wizard.backHome')}
          title={t('wizard.backHome')}
          onClick={guardLeave}
          data-testid="home-link"
        >
          <Wordmark />
        </Link>
      </header>

      <main className="wizard-main">
        <p className="wizard-step" data-testid="wizard-step">
          <Icon name={task.icon} />
          <span>
            {t(task.labelKey)} · {fill(t('wizard.step'), { n: String(stepNumber), total: String(totalSteps) })}
          </span>
        </p>
        <h1 className="wizard-title" ref={headingRef} tabIndex={-1} data-testid="wizard-title">
          {title}
        </h1>

        {step === 'pick' ? (
          <>
            <button
              type="button"
              className="dropzone"
              data-over={dragOver}
              onClick={() => inputRef.current?.click()}
              disabled={!hydrated || importing}
              aria-busy={importing}
              data-testid="pick-video"
            >
              <span className="dropzone-badge">
                <Icon name="upload" />
              </span>
              <span className="dropzone-label">
                {importing ? t('wizard.pick.reading') : dragOver ? t('wizard.pick.drop') : t('preview.pickVideo')}
              </span>
              <span className="dropzone-hint">{t(phone || touchScreen ? 'wizard.pick.hint' : 'wizard.pick.hintDrop')}</span>
            </button>
            <MediaErrorNotice t={t} error={state.mediaError} onDismiss={state.clearMediaError} />
          </>
        ) : null}

        {step === 'choose' && video ? (
          <>
            {preview ?? <VideoPreview video={video} />}
            <VideoRow
              video={video}
              onChange={() => inputRef.current?.click()}
              changing={importing}
            />
            <MediaErrorNotice t={t} error={state.mediaError} onDismiss={state.clearMediaError} />
            {typeof children === 'function'
              ? children({ capability: exporter.capability, busy, previewSize: exporter.previewSize })
              : children}
            {working ? null : (
              <div className="wizard-actions">
                {blockedText ? (
                  <p className="wizard-blocked" id="wizard-blocked" data-testid="wizard-blocked">
                    {blockedText}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="btn btn-accent wizard-go"
                  onClick={exporter.start}
                  disabled={!recipe || busy || importing}
                  aria-describedby={blockedText ? 'wizard-blocked' : undefined}
                  data-testid="wizard-download"
                >
                  <Icon name="download" />
                  {t(downloadLabelKey)}
                </button>
                {moreSettings}
              </div>
            )}
          </>
        ) : null}

        {step === 'result' && video && entry ? (
          <>
            <VideoRow video={video} />
            <div className="wizard-result" data-testid="wizard-result">
              <DownloadStatus
                t={t}
                entry={entry}
                kind={entry.kind}
                onCancel={exporter.cancel}
                onDismiss={exporter.dismiss}
                onReportProblem={() => setReportOpen(true)}
                onShare={exporter.share}
                device={phone || touchScreen}
              />
            </div>
            {entry.phase === 'running' ? <p className="wizard-hint">{t('wizard.result.keepOpen')}</p> : null}
            {finished ? (
              <div className="wizard-after">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    exporter.dismiss();
                    setPicking(true);
                  }}
                  data-testid="wizard-again"
                >
                  {t('wizard.result.again')}
                </button>
                <Link href="/" prefetch={false} className="btn" data-testid="wizard-home">
                  {t('wizard.backHome')}
                </Link>
              </div>
            ) : null}
            {!finished && entry.phase !== 'running' ? (
              <div className="wizard-after">
                <button type="button" className="btn" onClick={exporter.dismiss} data-testid="wizard-back-to-choice">
                  {t('wizard.result.backToChoice')}
                </button>
              </div>
            ) : null}
            {moreSettings}
          </>
        ) : null}
      </main>

      <footer className="wizard-footer">{t('home.trust')}</footer>

      {/*
        Hidden picker: the user always starts the file dialog. Rendered only
        after hydration (a file picked before the handler exists is lost).
      */}
      {hydrated ? (
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="video-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pick(file);
          }}
        />
      ) : null}
      {reportOpen ? <ReportDialog t={t} project={recipe ?? state.project} onClose={() => setReportOpen(false)} /> : null}
    </div>
  );
}

/** The picked video: its name, its length and "Değiştir". */
function VideoRow({ video, onChange, changing = false }: { video: MediaHandle; onChange?: () => void; changing?: boolean }) {
  return (
    <div className="video-row" data-testid="wizard-video-row">
      <span className="video-row-text">
        <span className="video-row-name" data-testid="wizard-video-name">
          {safeFileName(video.fileName, 48)}
        </span>
        <span className="video-row-length" data-testid="wizard-video-length">
          {lengthText(video.durationUs)}
        </span>
      </span>
      {onChange ? (
        <button
          type="button"
          className="btn btn-compact"
          onClick={onChange}
          disabled={changing}
          aria-label={t('wizard.video.changeLabel')}
          data-testid="wizard-change-video"
        >
          {t('wizard.video.change')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A small look at the picked video with one play button. `shape`: the video's
 * own (`wide`) or the 9:16 frame of "Dikey yap", where `fit` shows what
 * "Doldur" and "Sığdır" do — the same centre crop / letterbox the export makes
 * (`computeSourceView` at zoom 1).
 */
export function VideoPreview({
  video,
  shape = 'wide',
  fit = 'contain',
  label,
  mediaRef,
  onTime,
}: {
  video: MediaHandle;
  shape?: 'wide' | 'vertical';
  fit?: 'cover' | 'contain';
  label?: string;
  /** Lets the owner move the video (the transcript's lines jump to their moment). */
  mediaRef?: { current: HTMLVideoElement | null };
  /** The video's own time in µs, as it plays or is moved. */
  onTime?: (us: number) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const report = (event: { currentTarget: HTMLVideoElement }) => onTime?.(Math.round(event.currentTarget.currentTime * 1_000_000));
  const portrait = (video.displayHeight ?? 0) > (video.displayWidth ?? 0);

  const toggle = () => {
    const element = ref.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  };

  return (
    <div className="video-preview" data-shape={shape} data-portrait={portrait} data-testid="wizard-preview">
      <div className="video-preview-frame" data-fit={fit} data-testid="wizard-preview-frame">
        <video
          ref={(element) => {
            ref.current = element;
            if (mediaRef) mediaRef.current = element;
          }}
          onTimeUpdate={onTime ? report : undefined}
          onSeeked={onTime ? report : undefined}
          // "#t=0.1": show a picture, not an empty box, before anything plays.
          src={`${video.objectUrl}#t=0.1`}
          playsInline
          preload="metadata"
          aria-label={label ?? t('wizard.video.label')}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          data-testid="wizard-video"
        />
        <button
          type="button"
          className="play-btn video-preview-play"
          onClick={toggle}
          aria-label={playing ? t('preview.pause') : t('preview.play')}
          data-testid="wizard-play"
        >
          <Icon name={playing ? 'pause' : 'play'} size={22} />
        </button>
      </div>
    </div>
  );
}
