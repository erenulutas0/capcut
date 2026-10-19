'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { CapabilityReportV1 } from '@/adapters/exportCapability';
import { safeFileName, type MediaHandle } from '@/adapters/browserMedia';
import { SHARE_PARAM, takeVideoForWizard } from '@/adapters/pwa/sharedVideo';
import { BrowserNotice } from '@/components/BrowserNotice';
import { FallbackLink, NavigationFallbackScope } from '@/components/FallbackLink';
import { Icon, Wordmark } from '@/components/Icon';
import { lazyPart } from '@/components/LazyPart';
import { ReportProblemProvider } from '@/components/ReportProblem';
import { MediaErrorNotice } from '@/components/editor/MediaErrorNotice';
import type { ExportExtras, TargetSizePreview } from '@/components/editor/useDownloads';
import type { EditorState } from '@/components/editor/useEditorState';
import { useLayoutMode } from '@/components/editor/useLayoutMode';
import { useTouchScreen } from '@/components/editor/useTouchScreen';
import { useHydrated } from '@/components/useHydrated';
import type { Project } from '@/domain/edl';
import type { TargetSizeRequest } from '@/domain/targetSize';
import type { TaskDefinition } from '@/domain/tasks';
import { formatLengthShort } from '@/domain/time';
import { useT } from '@/i18n/locale';
import type { MessageKey } from '@/i18n/messages';
import type { Translate } from '@/i18n/translate';
import { PAGE_PENDING_ATTRIBUTE } from '@/pageWatchdog';
import { useWizardExport } from './useWizardExport';

/** "Sorun bildir": opened by a press after a failure, so its code comes with that press, not with the page. */
const ReportDialog = lazyPart(() => import('@/components/editor/ReportDialog').then((module) => module.ReportDialog), { close: (props) => props.onClose });
/** The download's status (progress, the saved file, a failure): shown from the press of the download button on. */
const DownloadStatus = lazyPart(() => import('@/components/editor/DownloadStatus').then((module) => module.DownloadStatus), {
  variant: 'inline',
});

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function lengthText(us: number, t: Translate): string {
  return formatLengthShort(us, { second: t('time.secondShort'), decimalMark: t('time.decimalMark') });
}

/**
 * How the editor opens over a wizard's work. `stored`: the work becomes the browser's stored project
 * (only "Yazıya dök" asks for it, over a transcript — ADR-034 addendum of 13 Oct 2026). Left out, as
 * every other wizard does: nothing is stored.
 */
export interface EditorHandoff {
  stored: boolean;
}

/** What every wizard gets from the route (`TaskWizard`). */
export interface WizardHostProps {
  task: TaskDefinition;
  /** The recipe and the open files: the same state the editor works on. */
  state: EditorState;
  /** Shows the editor over this very state: same video, same settings, no second file dialog. */
  onOpenEditor: (handoff?: EditorHandoff) => void;
}

/**
 * A task that makes a file of its own instead of a video ("GIF yap", ADR-046). Its own button is part of
 * its choose step (the children); its own card is the result step. There is no "İndir" of the export
 * and no "Daha fazla ayar → editörde aç": the editor does not make that file.
 */
export interface OwnDownload {
  /** Where the task's own download stands; null while nothing was started (the choose step). */
  phase: 'running' | 'saved' | 'ready' | 'canceled' | 'failed' | null;
  busy: boolean;
  /** The result step's card: progress, the saved file, a failure. */
  status: ReactNode;
  /** The heading when the file waits for its save button ("GIF'in hazır"). */
  readyTitle: string;
  cancel: () => void;
  /** Back to the choose step, the same video and choices still there. */
  dismiss: () => void;
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
  /** Said as the choose step's heading instead, while a screen of the step has its own question. */
  chooseTitle?: string | null;
  /** Said at the foot instead of "Videon cihazından çıkmaz." — where that sentence alone would mislead (ADR-039). */
  footerText?: string | null;
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
  /**
   * Said above "Daha fazla ayar → editörde aç" once a download is over, when opening the editor does more
   * than change settings ("Yazıya dök" over a transcript: it is what keeps the text).
   */
  editorNote?: string | null;
  /** The task saves a file of its own (see `OwnDownload`). */
  ownDownload?: OwnDownload;
  /**
   * No "Daha fazla ayar → editörde aç": the editor cannot make what this task makes ("Sesi düzelt",
   * ADR-049 — the editor would download the sound as it was), so offering it would be a false promise.
   */
  noEditor?: boolean;
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
  chooseTitle = null,
  footerText = null,
  fileTag,
  recipe,
  audioFile = null,
  exportExtras,
  working = false,
  blockedText = null,
  preview,
  beforeEditor,
  downloadLabelKey = 'wizard.download',
  editorNote = null,
  ownDownload,
  noEditor = false,
  children,
}: Props) {
  const t = useT();
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
  const openReport = useCallback(() => setReportOpen(true), []);

  const exporter = useWizardExport({
    project: recipe ?? state.project,
    settings: state.settings,
    // A task with a download of its own never asks the export anything (no encoder check in the background).
    videoFile: ownDownload ? null : (video?.file ?? null),
    videoName: video?.fileName ?? null,
    audioFile,
    fileTag,
    extras: exportExtras,
  });
  const { entry } = exporter;
  const busy = ownDownload ? ownDownload.busy : exporter.busy;
  const ownPhase = ownDownload?.phase ?? null;
  const started = ownDownload ? ownPhase !== null : entry !== null;
  const dismissResult = () => (ownDownload ? ownDownload.dismiss() : exporter.dismiss());

  const step: Step = !video || picking ? 'pick' : started ? 'result' : 'choose';
  const resultPhase = ownDownload ? ownPhase : (entry?.phase ?? null);
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
    dismissResult();
    const opened = await openVideo(file);
    if (opened) setPicking(false);
  };
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });

  // Opened from the opening screen with a video in hand (shared to the app, ADR-047: `?paylasim=<id>`):
  // that video is picked at once — no second file dialog — and its stored copy is deleted. Once per
  // page; the address loses the query, so a reload is this wizard's own first step again.
  const [shareGone, setShareGone] = useState<'gone' | 'lost' | null>(null);
  const sharedTried = useRef(false);
  useEffect(() => {
    if (!hydrated || sharedTried.current) return;
    sharedTried.current = true;
    const search = window.location.search;
    if (!search.includes(`${SHARE_PARAM}=`)) return;
    try {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    } catch {
      // The address keeps its query; the stored copy is gone either way.
    }
    void takeVideoForWizard(search).then((taken) => {
      if (taken === 'gone' || taken === 'lost') setShareGone(taken);
      else if (taken) void pickRef.current(taken.file);
    });
  }, [hydrated]);

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
        if (window.confirm(t('wizard.leaveWarning'))) (ownDownload ? ownDownload.cancel : exporter.cancel)();
        return;
      }
      dismissResult();
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
      : step === 'choose' || resultPhase === null
        ? (step === 'choose' && chooseTitle) || t(titleKey)
        : resultPhase === 'running'
          ? t('wizard.result.running')
          : resultPhase === 'saved'
            ? t('wizard.result.saved')
            : resultPhase === 'ready'
              ? ownDownload
                ? ownDownload.readyTitle
                : t(entry?.phase === 'ready' && entry.result.output === 'audio' ? 'wizard.result.readyAudio' : 'wizard.result.ready')
              : resultPhase === 'canceled'
                ? t('wizard.result.canceled')
                : t('wizard.result.failed');

  const finished = resultPhase === 'saved' || resultPhase === 'ready';
  const moreSettings =
    video && !working && !busy && !ownDownload && !noEditor ? (
      <button type="button" className="link-button wizard-more" onClick={openEditor} data-testid="wizard-open-editor">
        {t('wizard.moreSettings')}
      </button>
    ) : null;

  return (
    <NavigationFallbackScope>
    <ReportProblemProvider value={openReport}>
    <div className="wizard" data-step={step} data-task={task.id} data-testid="wizard" {...(hydrated ? {} : { [PAGE_PENDING_ATTRIBUTE]: '' })}>
      <header className="wizard-bar">
        {step === 'pick' ? (
          <FallbackLink href="/" className="wizard-back" onClick={guardLeave} data-testid="wizard-back">
            <Icon name="back" />
            {t('wizard.back')}
          </FallbackLink>
        ) : (
          <button type="button" className="wizard-back" onClick={back} data-testid="wizard-back">
            <Icon name="back" />
            {t('wizard.back')}
          </button>
        )}
        <FallbackLink
          href="/"
          opening={false}
          className="wordmark-link"
          aria-label={t('wizard.backHome')}
          title={t('wizard.backHome')}
          onClick={guardLeave}
          data-testid="home-link"
        >
          <Wordmark />
        </FallbackLink>
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
        {/*
          Said before the user spends time on a task this browser cannot finish. Not on "Yazıya dök": its text and
          subtitle files need no video file to be made; only its burned-in download does, and that one says so itself.
        */}
        {step !== 'result' && task.id !== 'yazi' ? <BrowserNotice t={t} capability={video ? exporter.capability : null} /> : null}

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
            {shareGone ? (
              <p className="wizard-hint" data-testid="wizard-share-gone" data-reason={shareGone}>
                {t(shareGone === 'lost' ? 'wizard.share.lost' : 'wizard.share.gone')}
              </p>
            ) : null}
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
            {working || ownDownload ? null : (
              <>
                {/* On a phone this bar stays at the bottom of the screen (wizard.css): the main action is never below it. */}
                <div className="wizard-actions wizard-action-bar" data-testid="wizard-actions">
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
                </div>
                {moreSettings}
              </>
            )}
          </>
        ) : null}

        {step === 'result' && video && resultPhase !== null ? (
          <>
            <VideoRow video={video} />
            <div className="wizard-result" data-testid="wizard-result">
              {ownDownload ? (
                ownDownload.status
              ) : entry ? (
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
              ) : null}
            </div>
            {resultPhase === 'running' ? <p className="wizard-hint">{t('wizard.result.keepOpen')}</p> : null}
            {finished ? (
              <div className="wizard-after">
                {ownDownload ? (
                  // Another GIF of the same video: the part, the size and the text are still there.
                  <button type="button" className="btn" onClick={dismissResult} data-testid="wizard-again-same">
                    {t('wizard.gif.again')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    dismissResult();
                    setPicking(true);
                  }}
                  data-testid="wizard-again"
                >
                  {t('wizard.result.again')}
                </button>
                <FallbackLink href="/" className="btn" data-testid="wizard-home">
                  {t('wizard.backHome')}
                </FallbackLink>
              </div>
            ) : null}
            {!finished && resultPhase !== 'running' ? (
              <div className="wizard-after">
                <button type="button" className="btn" onClick={dismissResult} data-testid="wizard-back-to-choice">
                  {t('wizard.result.backToChoice')}
                </button>
              </div>
            ) : null}
            {moreSettings && editorNote ? (
              <p className="wizard-hint" data-testid="wizard-editor-note">
                {editorNote}
              </p>
            ) : null}
            {moreSettings}
          </>
        ) : null}
      </main>

      <footer className="wizard-footer" data-testid="wizard-footer">
        {footerText ?? t('home.trust')}
      </footer>

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
    </ReportProblemProvider>
    </NavigationFallbackScope>
  );
}

/** The picked video: its name, its length and "Değiştir". */
function VideoRow({ video, onChange, changing = false }: { video: MediaHandle; onChange?: () => void; changing?: boolean }) {
  const t = useT();
  return (
    <div className="video-row" data-testid="wizard-video-row">
      <span className="video-row-text">
        <span className="video-row-name" data-testid="wizard-video-name">
          {safeFileName(video.fileName, 48)}
        </span>
        <span className="video-row-length" data-testid="wizard-video-length">
          {lengthText(video.durationUs, t)}
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
  muted = false,
  mediaRef,
  onTime,
}: {
  video: MediaHandle;
  shape?: 'wide' | 'vertical';
  fit?: 'cover' | 'contain';
  label?: string;
  /** Plays without sound: the preview of a result that has none ("Sesi kapat"). */
  muted?: boolean;
  /** Lets the owner move the video (the transcript's lines jump to their moment). */
  mediaRef?: { current: HTMLVideoElement | null };
  /** The video's own time in µs, as it plays or is moved. */
  onTime?: (us: number) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const report =(event: { currentTarget: HTMLVideoElement }) => onTime?.(Math.round(event.currentTarget.currentTime * 1_000_000));
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
          muted={muted}
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
