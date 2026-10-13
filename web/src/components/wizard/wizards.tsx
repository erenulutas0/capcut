'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { safeFileName } from '@/adapters/browserMedia';
import { applySilenceCuts, withWholeKesit } from '@/application/commands';
import { downloadFrame } from '@/application/downloadFrame';
import { reviewSilences } from '@/application/silenceReview';
import {
  MUSIC_ALONE_DB,
  MUSIC_BEHIND_DB,
  alreadyPlaysEverywhere,
  lengthsAfterCut,
  musicLengthUs,
  musicOutlastsVideo,
  ownSizeRecipe,
  silenceParamsFor,
  musicUnderVideo,
  soundlessRecipe,
  withMusicDefaults,
  type GapChoice,
} from '@/application/taskRecipes';
import { FailureDetails } from '@/components/FailureDetails';
import { Icon } from '@/components/Icon';
import type { TargetSizePreview } from '@/components/editor/useDownloads';
import { useSilenceAnalysis } from '@/components/editor/useSilenceAnalysis';
import { useHydrated } from '@/components/useHydrated';
import { formatStorageBytes } from '@/domain/outputStorage';
import { WEB_LOCAL_POLICY, formatByteLimit, formatBytes } from '@/domain/policy';
import { SIZE_PRESETS, type SizePresetId, type TargetSizeRequest } from '@/domain/targetSize';
import type { AvailableTaskId } from '@/domain/tasks';
import { formatTimecode } from '@/domain/time';
import { translator, type MessageKey } from '@/i18n/messages';
import { ChoiceOption } from './ChoiceOption';
import { VideoPreview, WizardFlow, fill, lengthText, type FlowInfo, type WizardHostProps } from './WizardFlow';

const t = translator('tr');

/** Envelope frames are 10 ms; progress is a share of the video. */
function percentOf(done: number, total: number): number | null {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
}

// ---------------------------------------------------------------- Kes

/**
 * "Kes": the kesit editor IS this task (ADR-026/030). The wizard only picks
 * the video; the editor opens over it at once, first-run hint included.
 *
 * The download keeps the video's own size, as every other wizard does
 * (`ownSizeRecipe`): a 720p video is not blown up to the editor's 1080p
 * default — which also made every cut a full re-encode, because the fast cut
 * (ADR-027) only copies pictures at the source's own size.
 */
function KesWizard(host: WizardHostProps) {
  const { state, onOpenEditor } = host;
  return (
    <WizardFlow
      {...host}
      titleKey="task.kes.label"
      fileTag="kesit"
      recipe={null}
      working
      openVideo={async (file) => {
        const outcome = await state.importVideo(file, ownSizeRecipe);
        if (outcome.kind !== 'opened') return false;
        onOpenEditor();
        return true;
      }}
    >
      {null}
    </WizardFlow>
  );
}

// ---------------------------------------------------------------- Boşlukları at

/**
 * "Boşlukları at": the silence analysis of ADR-018 over the whole video, the
 * longest gaps that fit the 20-kesit limit removed, the rest joined. One
 * choice: long gaps only (the default) or short pauses too.
 */
function BoslukWizard(host: WizardHostProps) {
  const { state } = host;
  const silence = useSilenceAnalysis();
  const [choice, setChoice] = useState<GapChoice>('long');
  const { project, settings, video } = state;

  const search = (file: File, lengthUs: number) => silence.start(file, [{ sourceInUs: 0, sourceOutUs: lengthUs }]);

  // The whole video as one kesit: what the analysis searched and what the cuts apply to.
  const whole = useMemo(() => {
    const result = withWholeKesit(project, settings, WEB_LOCAL_POLICY);
    return result.ok ? result.project : null;
  }, [project, settings]);
  const done = silence.run.status === 'done';
  const review = useMemo(
    () => (whole && done ? reviewSilences(whole, silence.envelopeFor, silenceParamsFor(choice), WEB_LOCAL_POLICY) : null),
    [whole, done, silence.envelopeFor, choice],
  );
  // The longest gaps that fit the kesit limit (`reviewSilences` picks them).
  const chosen = useMemo(
    () => (review ? review.suggestions.filter((item) => review.defaultIds.has(item.id)) : []),
    [review],
  );
  const cut = useMemo(() => (whole && chosen.length > 0 ? applySilenceCuts(whole, chosen, WEB_LOCAL_POLICY) : null), [whole, chosen]);
  const recipe = cut?.ok ? cut.project : null;
  const status = review?.clips[0]?.status ?? null;
  const running = silence.run.status === 'running';
  const percent = silence.run.status === 'running' ? percentOf(silence.run.framesDone, silence.run.framesTotal) : null;
  const lengths = whole && recipe ? lengthsAfterCut(whole, recipe) : null;

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.bosluk.title"
      fileTag="bosluksuz"
      recipe={recipe}
      working={!done || status !== 'ok'}
      openVideo={async (file) => {
        silence.reset();
        const outcome = await state.importVideo(file, ownSizeRecipe);
        if (outcome.kind !== 'opened') return false;
        // The video's own frame: a shape between the frames gets bars, nothing is cut off.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        setChoice('long');
        search(file, outcome.lengthUs);
        return true;
      }}
      // The same cuts, as kesitler in the editor (one undo step there).
      beforeEditor={() => {
        if (chosen.length > 0) state.cutSilences(chosen, true);
      }}
    >
      {({ busy }) => (
        <>
          {running ? (
            <div className="wizard-panel" data-testid="bosluk-searching">
              <p className="wizard-panel-title" role="status">
                {t('wizard.bosluk.searching')}
              </p>
              <div
                className="progress-track"
                role="progressbar"
                aria-label={t('wizard.bosluk.searching')}
                aria-valuemin={0}
                aria-valuemax={100}
                {...(percent === null ? {} : { 'aria-valuenow': percent })}
              >
                <div
                  className={percent === null ? 'progress-fill progress-indeterminate' : 'progress-fill'}
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </div>
              <p className="wizard-hint">{t('wizard.bosluk.searchingHint')}</p>
              <button type="button" className="btn" onClick={silence.cancel} data-testid="bosluk-stop">
                {t('wizard.bosluk.stop')}
              </button>
            </div>
          ) : null}

          {silence.run.status === 'failed' || silence.run.status === 'canceled' || silence.run.status === 'idle' ? (
            <div className="wizard-panel" data-testid="bosluk-problem">
              {silence.run.status === 'failed' ? (
                <p className="wizard-panel-title" role="alert">
                  {t(`silence.failed.${silence.run.reason}` as MessageKey)}
                </p>
              ) : null}
              {silence.run.status === 'failed' ? <FailureDetails t={t} detail={silence.run.detail} testId="bosluk-failed" /> : null}
              <div className="wizard-after">
                {/* A video without sound cannot be searched again with a different answer. */}
                {video && !(silence.run.status === 'failed' && silence.run.reason === 'no_audio') ? (
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => search(video.file, video.durationUs)}
                    data-testid="bosluk-retry"
                  >
                    {t('wizard.bosluk.retry')}
                  </button>
                ) : null}
                <button type="button" className="btn" onClick={() => host.onOpenEditor()} data-testid="bosluk-open-editor">
                  {t('wizard.bosluk.openEditor')}
                </button>
              </div>
            </div>
          ) : null}

          {done && status !== null && status !== 'ok' ? (
            <div className="wizard-panel" data-testid="bosluk-unclear">
              <p className="wizard-panel-title" role="status">
                {t(status === 'too_short' ? 'wizard.bosluk.tooShort' : 'wizard.bosluk.unclear')}
              </p>
              <div className="wizard-after">
                <button type="button" className="btn" onClick={() => host.onOpenEditor()} data-testid="bosluk-open-editor">
                  {t('wizard.bosluk.openEditor')}
                </button>
              </div>
            </div>
          ) : null}

          {done && status === 'ok' && review ? (
            <>
              <div className="wizard-panel" role="status" data-testid="bosluk-summary">
                {chosen.length > 0 && lengths ? (
                  <>
                    <p className="wizard-panel-title" data-testid="bosluk-found">
                      {fill(t('wizard.bosluk.found'), { n: String(review.suggestions.length) })}
                    </p>
                    <p className="wizard-panel-big" data-testid="bosluk-shorter">
                      {fill(t('wizard.bosluk.shorter'), {
                        before: lengthText(lengths.beforeUs),
                        after: lengthText(lengths.afterUs),
                      })}
                    </p>
                    {review.leftOut > 0 ? (
                      <p className="wizard-hint" data-testid="bosluk-limit">
                        {fill(t('wizard.bosluk.limit'), {
                          max: String(WEB_LOCAL_POLICY.maxClips),
                          n: String(chosen.length),
                          left: String(review.leftOut),
                        })}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="wizard-panel-title" data-testid="bosluk-none">
                      {t('wizard.bosluk.none.title')}
                    </p>
                    <p className="wizard-hint">{t('wizard.bosluk.none.body')}</p>
                  </>
                )}
              </div>
              <fieldset className="wizard-choice" data-testid="bosluk-choice">
                <legend>{t('wizard.bosluk.choice')}</legend>
                <ChoiceOption
                  name="gap"
                  value="long"
                  checked={choice === 'long'}
                  disabled={busy}
                  onSelect={() => setChoice('long')}
                  label={t('wizard.bosluk.long')}
                  hint={t('wizard.bosluk.longHint')}
                />
                <ChoiceOption
                  name="gap"
                  value="short"
                  checked={choice === 'short'}
                  disabled={busy}
                  onSelect={() => setChoice('short')}
                  label={t('wizard.bosluk.short')}
                  hint={t('wizard.bosluk.shortHint')}
                />
              </fieldset>
            </>
          ) : null}
        </>
      )}
    </WizardFlow>
  );
}

// ---------------------------------------------------------------- Dikey yap

/**
 * "Dikey yap": the 9:16 frame of Reels / TikTok / Shorts. One choice: fill
 * the frame (the sides are cut) or fit the whole picture (empty space
 * remains), shown live in the frame.
 *
 * The picture is never enlarged (ADR-041): "Doldur" keeps the slice it cuts
 * out at its own size (406 × 720 from a 1280 × 720 video; 1080 × 1920 only
 * from a video that has that many), "Sığdır" adds the bars around the
 * picture as it is. The size the file will have is said under the choice,
 * from the download's own plan.
 */
function DikeyWizard(host: WizardHostProps) {
  const { state } = host;
  const { video } = state;
  const fit = state.settings.fit;
  const vertical = state.project.canvas.aspect === '9:16';
  const already = video !== null && (video.displayWidth ?? 0) * 16 === (video.displayHeight ?? 0) * 9;
  const frame = useMemo(() => (video && vertical ? downloadFrame(state.project, state.settings) : null), [state.project, state.settings, vertical, video]);
  const withSize = (key: MessageKey) => (frame ? fill(t(key), { width: String(frame.width), height: String(frame.height) }) : '');

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.dikey.title"
      fileTag="dikey"
      recipe={video && vertical ? state.project : null}
      preview={
        video ? <VideoPreview video={video} shape="vertical" fit={fit} label={t('wizard.dikey.preview')} /> : undefined
      }
      openVideo={async (file) => {
        const outcome = await state.importVideo(file);
        if (outcome.kind !== 'opened') return false;
        state.changeFraming({ aspect: '9:16', fit: 'cover', zoom: 1 });
        return true;
      }}
    >
      {({ busy }) => (
        <>
          {already ? (
            <p className="wizard-hint" data-testid="dikey-already">
              {withSize('wizard.dikey.already')}
            </p>
          ) : (
            <fieldset className="wizard-choice" data-testid="dikey-choice">
              <legend>{t('wizard.dikey.choice')}</legend>
              <ChoiceOption
                name="fit"
                value="cover"
                checked={fit === 'cover'}
                disabled={busy}
                onSelect={() => state.changeFraming({ fit: 'cover' })}
                label={t('wizard.dikey.cover')}
                hint={t('wizard.dikey.coverHint')}
              />
              <ChoiceOption
                name="fit"
                value="contain"
                checked={fit === 'contain'}
                disabled={busy}
                onSelect={() => state.changeFraming({ fit: 'contain' })}
                label={t('wizard.dikey.contain')}
                hint={t('wizard.dikey.containHint')}
              />
            </fieldset>
          )}
          {already ? null : (
            <p className="wizard-hint" data-testid="dikey-size" data-width={frame?.width} data-height={frame?.height}>
              {withSize(frame?.rule === 'source' ? 'wizard.dikey.noteOwnSize' : 'wizard.dikey.note')}
            </p>
          )}
        </>
      )}
    </WizardFlow>
  );
}

// ---------------------------------------------------------------- Müzik ekle

/**
 * "Müzik ekle": the user's own music file under the whole video. One choice:
 * the video's own sound stays (music quietly behind it) or goes (music
 * alone). The level and the fade-out are set for the user.
 */
function MuzikWizard(host: WizardHostProps) {
  const { state } = host;
  const hydrated = useHydrated();
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const { video, audio, project, settings } = state;
  // A video with no sound of its own has nothing to keep: no question, music at full level.
  const silentVideo = video?.hasAudio === false;
  const muted = settings.muted;
  const music = project.music ?? null;
  const ready = video !== null && audio !== null && music !== null;
  const readingMusic = state.importing === 'audio';

  const setVideoSound = (keep: boolean) => {
    state.changeVideoMuted(!keep);
    if (music) state.changeMusic({ gainDb: keep ? MUSIC_BEHIND_DB : MUSIC_ALONE_DB });
  };

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.muzik.title"
      fileTag="muzikli"
      recipe={ready ? project : null}
      audioFile={audio?.file ?? null}
      blockedText={ready ? null : t('wizard.muzik.first')}
      openVideo={async (file) => {
        const outcome = await state.importVideo(file, musicUnderVideo);
        if (outcome.kind !== 'opened') return false;
        // The video's own frame: a shape between the frames gets bars, nothing is cut off.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        return true;
      }}
    >
      {({ busy }) => (
        <>
          {audio && music ? (
            <div className="wizard-panel" data-testid="muzik-picked">
              <div className="video-row">
                <span className="video-row-text">
                  <span className="video-row-name" data-testid="muzik-name">
                    {safeFileName(audio.fileName, 48)}
                  </span>
                  <span className="video-row-length">{lengthText(audio.durationUs)}</span>
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={busy || readingMusic}
                  aria-label={t('wizard.muzik.changeLabel')}
                  data-testid="muzik-change"
                >
                  {t('wizard.muzik.change')}
                </button>
              </div>
              <audio className="wizard-audio" controls src={audio.objectUrl} preload="metadata" aria-label={t('wizard.muzik.label')} />
              <p className="wizard-hint" data-testid="muzik-length-note">
                {musicOutlastsVideo(project)
                  ? t('wizard.muzik.longer')
                  : fill(t('wizard.muzik.shorter'), { length: lengthText(musicLengthUs(project)) })}
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="dropzone dropzone-small"
              onClick={() => audioInputRef.current?.click()}
              disabled={!hydrated || readingMusic}
              aria-busy={readingMusic}
              data-testid="muzik-pick"
            >
              <span className="dropzone-badge">
                <Icon name="taskMusic" />
              </span>
              <span className="dropzone-label">{readingMusic ? t('wizard.muzik.reading') : t('wizard.muzik.pick')}</span>
              <span className="dropzone-hint">{t('wizard.muzik.pickHint')}</span>
            </button>
          )}

          {silentVideo ? null : (
            <fieldset className="wizard-choice" data-testid="muzik-choice">
              <legend>{t('wizard.muzik.choice')}</legend>
              <ChoiceOption
                name="video-sound"
                value="keep"
                checked={!muted}
                disabled={busy}
                onSelect={() => setVideoSound(true)}
                label={t('wizard.muzik.keep')}
                hint={t('wizard.muzik.keepHint')}
              />
              <ChoiceOption
                name="video-sound"
                value="mute"
                checked={muted}
                disabled={busy}
                onSelect={() => setVideoSound(false)}
                label={t('wizard.muzik.mute')}
                hint={t('wizard.muzik.muteHint')}
              />
            </fieldset>
          )}

          {hydrated ? (
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="audio-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                // The level follows the choice already made; a silent video gets the music alone.
                const keep = !silentVideo && !muted;
                void state.importAudio(file, (next) => withMusicDefaults(next, keep));
              }}
            />
          ) : null}
        </>
      )}
    </WizardFlow>
  );
}

// ---------------------------------------------------------------- Her yerde açılsın

/**
 * "Her yerde açılsın": no decision. The whole video as standard H.264 / AAC
 * MP4 in its own frame (letterboxed only when its shape is none of the
 * frames), at its own size up to Full HD. A file that already is that is
 * told so; the download then keeps its pictures where the fast cut allows.
 */
function CevirWizard(host: WizardHostProps) {
  const { state } = host;
  const { video } = state;
  return (
    <WizardFlow
      {...host}
      titleKey="wizard.cevir.title"
      fileTag="uyumlu"
      recipe={video ? state.project : null}
      openVideo={async (file) => {
        const outcome = await state.importVideo(file, ownSizeRecipe);
        if (outcome.kind !== 'opened') return false;
        // Nothing of the picture is cut off: a shape between the frames gets bars.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        return true;
      }}
    >
      {({ capability }) => (
        <div className="wizard-panel" data-testid="cevir-info">
          <p className="wizard-panel-title">{t('wizard.cevir.body')}</p>
          <p className="wizard-hint">{t('wizard.cevir.keeps')}</p>
          {video && alreadyPlaysEverywhere(capability?.source ?? null, video.fileName) ? (
            <p className="wizard-note" role="status" data-testid="cevir-already">
              <Icon name="info" />
              <span>{t('wizard.cevir.already')}</span>
            </p>
          ) : null}
        </div>
      )}
    </WizardFlow>
  );
}

// ---------------------------------------------------------------- Küçült

/**
 * The order the choices are shown in: the smallest first. It is what the card
 * promises ("WhatsApp’a sığdır") and so it is the default.
 */
const SIZE_CHOICES: readonly SizePresetId[] = ['whatsapp', 'email', 'share'];

/** The smallest of the ready-made sizes: a video already under it fits everywhere. */
const SMALLEST_PRESET_BYTES = Math.min(...SIZE_PRESETS.map((preset) => preset.bytes));

/**
 * `half`: about half of what the video weighs now. Offered only to a video
 * that is already under every ready-made size — the one way left to make it
 * smaller, so "it already fits" is never a dead end.
 */
type SizeChoiceId = SizePresetId | 'half';

type SizePreviews = Partial<Record<SizeChoiceId, TargetSizePreview>>;

/** What picking an option would do, known before anything is encoded. */
type SizeState =
  /** Still being worked out. */
  | 'pending'
  /** The video is already at or under this size: there is nothing to shrink. */
  | 'already'
  /** It cannot be made this small. */
  | 'refused'
  /** It will be made smaller. */
  | 'shrinks';

function halfTargetBytes(videoBytes: number): number {
  return Math.max(1, Math.floor(videoBytes / 2));
}

function targetBytesOf(id: SizeChoiceId, videoBytes: number): number {
  if (id === 'half') return halfTargetBytes(videoBytes);
  return SIZE_PRESETS.find((preset) => preset.id === id)?.bytes ?? SMALLEST_PRESET_BYTES;
}

function sizeState(id: SizeChoiceId, preview: TargetSizePreview | undefined, videoBytes: number): SizeState {
  // The file itself is already under the limit: no download would make it "fit" any better.
  if (id !== 'half' && videoBytes <= targetBytesOf(id, videoBytes)) return 'already';
  if (!preview) return 'pending';
  if (!preview.ok) return preview.reason === 'target_too_small' ? 'refused' : 'pending';
  return 'shrinks';
}

/** The options a video gets: the three places it may have to fit, and "half" when it already fits them all. */
function sizeChoices(videoBytes: number): SizeChoiceId[] {
  return videoBytes <= SMALLEST_PRESET_BYTES ? [...SIZE_CHOICES, 'half'] : [...SIZE_CHOICES];
}

/**
 * The option chosen before the user chooses: the smallest size the video can
 * really be shrunk to — WhatsApp, as the card says, whenever that works. When
 * nothing would shrink (it already fits, or cannot fit) WhatsApp stays chosen
 * and the step says why there is nothing to download.
 */
function defaultSizeChoice(previews: SizePreviews, videoBytes: number): SizeChoiceId {
  return SIZE_CHOICES.find((id) => sizeState(id, previews[id], videoBytes) === 'shrinks') ?? 'whatsapp';
}

/**
 * What one size would give, said before anything is encoded (ADR-035), in
 * plain words: about how large the file will be and what happens to the
 * picture — "already fits", or the honest "does not fit" with the smallest
 * size that would. The pixel size is in the result's "Ayrıntılar".
 */
function sizeHint(id: SizeChoiceId, preview: TargetSizePreview | undefined, videoBytes: number): string {
  const mark = t('time.decimalMark');
  const state = sizeState(id, preview, videoBytes);
  if (state === 'already') return fill(t('wizard.kucult.alreadyFits'), { size: formatBytes(videoBytes, mark) });
  if (state === 'pending' || !preview) return t('wizard.kucult.calculating');
  if (!preview.ok) {
    return preview.reason === 'target_too_small'
      ? fill(t(id === 'half' ? 'wizard.kucult.halfTooSmall' : 'wizard.kucult.tooSmall'), {
          min: formatStorageBytes(preview.refusal.minBytes, 'up', mark),
        })
      : t('wizard.kucult.calculating');
  }
  const { decision } = preview;
  const values = { size: formatBytes(decision.plannedBytes, mark), seconds: String(preview.estimatedSeconds) };
  if (decision.mode === 'normal') return fill(t('wizard.kucult.planNormal'), values);
  // Honest about the picture: fewer bits always, and a smaller picture when the size had to drop too.
  return fill(t(decision.shortEdge < preview.fullShortEdge ? 'wizard.kucult.planSmaller' : 'wizard.kucult.plan'), values);
}

/**
 * The size choice of "Küçült". The previews are asked once per video (the
 * planner is pure arithmetic plus one question to the browser about its
 * encoder), so every option says its outcome before the user picks.
 */
function SizeChoice({
  info,
  videoBytes,
  recipeKey,
  choice,
  onChoice,
  previews,
  onPreviews,
}: {
  info: FlowInfo;
  videoBytes: number;
  /** Changes when the video (and so the recipe) changes. */
  recipeKey: string;
  choice: SizeChoiceId;
  onChoice: (id: SizeChoiceId) => void;
  previews: SizePreviews;
  onPreviews: (key: string, previews: SizePreviews) => void;
}) {
  const { previewSize } = info;
  useEffect(() => {
    let live = true;
    void Promise.all(
      sizeChoices(videoBytes).map(
        async (id) => [id, await previewSize({ targetBytes: targetBytesOf(id, videoBytes) })] as const,
      ),
    ).then((entries) => {
      if (live) onPreviews(recipeKey, Object.fromEntries(entries) as SizePreviews);
    });
    return () => {
      live = false;
    };
    // `previewSize` follows the recipe; the key says when the video changed.
  }, [previewSize, recipeKey, onPreviews, videoBytes]);

  return (
    <fieldset className="wizard-choice" data-testid="kucult-choice">
      <legend>{t('wizard.kucult.choice')}</legend>
      {sizeChoices(videoBytes).map((id) => {
        const preview = previews[id];
        const state = sizeState(id, preview, videoBytes);
        return (
          <label className="wizard-option" data-checked={choice === id} key={id}>
            <input
              type="radio"
              name="size"
              value={id}
              checked={choice === id}
              disabled={info.busy}
              onChange={() => onChoice(id)}
              data-testid={`option-${id}`}
            />
            <span className="wizard-option-text">
              <span className="wizard-option-label">{t(`wizard.kucult.${id}` as MessageKey)}</span>
              <span
                className="wizard-option-hint"
                data-testid={`size-hint-${id}`}
                data-state={state === 'shrinks' && preview?.ok ? preview.decision.mode : state === 'shrinks' ? 'pending' : state}
                data-planned-bytes={state === 'shrinks' && preview?.ok ? preview.decision.plannedBytes : undefined}
                data-short-edge={state === 'shrinks' && preview?.ok ? preview.decision.shortEdge : undefined}
                data-min-bytes={preview && !preview.ok && preview.reason === 'target_too_small' ? preview.refusal.minBytes : undefined}
              >
                {sizeHint(id, preview, videoBytes)}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * "Küçült" (ADR-035, addendum of 10 Oct 2026): the whole video at or under a
 * size. One choice — where it has to fit — with WhatsApp chosen, as the card
 * says, and every option says what it would give before "İndir": about how
 * large the file will be and what happens to the picture, that the video
 * already fits, or that it cannot fit and what the smallest size is.
 *
 * A video that is already under the chosen size is NOT downloaded again: a
 * copy of the same weight under a new name, announced as "Kaydedildi", is a
 * shrink that shrank nothing. The step says so ("Bu video zaten 473 KB…") and
 * points at a smaller option; a video under every ready-made size gets one
 * more, "Daha da küçült" (about half). The result line then says what the
 * saved file really weighs.
 */
function KucultWizard(host: WizardHostProps) {
  const { state } = host;
  const { video } = state;
  /** The user's own pick; null while the default stands. */
  const [picked, setPicked] = useState<SizeChoiceId | null>(null);
  const [previews, setPreviews] = useState<{ key: string; previews: SizePreviews }>({ key: '', previews: {} });
  const onPreviews = useCallback((key: string, next: SizePreviews) => setPreviews({ key, previews: next }), []);
  const recipeKey = video ? `${video.fileName}|${video.file.size}|${video.durationUs}|${state.project.export.shortEdge}` : '';
  const current = previews.key === recipeKey ? previews.previews : {};
  const videoBytes = video?.file.size ?? 0;
  const offered = sizeChoices(videoBytes);
  const choice = picked !== null && offered.includes(picked) ? picked : defaultSizeChoice(current, videoBytes);
  const targetBytes = targetBytesOf(choice, videoBytes);
  const selected = current[choice];
  const selectedState = sizeState(choice, selected, videoBytes);
  const refused = selected && !selected.ok && selected.reason === 'target_too_small' ? selected.refusal : null;
  const request = useMemo<TargetSizeRequest>(() => ({ targetBytes }), [targetBytes]);
  const extras = useMemo(() => ({ targetSize: request }), [request]);
  const mark = t('time.decimalMark');
  /** Whether some other option would still make this video smaller. */
  const smallerWay = offered.some((id) => id !== choice && sizeState(id, current[id], videoBytes) === 'shrinks');

  const blockedText =
    selectedState === 'already'
      ? `${fill(t('wizard.kucult.alreadyBlocked'), { size: formatBytes(videoBytes, mark) })}${
          smallerWay ? ` ${t(offered.includes('half') ? 'wizard.kucult.alreadyHalf' : 'wizard.kucult.alreadySmaller')}` : ''
        }`
      : selectedState === 'refused' && refused
        ? fill(t(refused.maxDurationUs >= 1_000_000 ? 'wizard.kucult.blocked' : 'wizard.kucult.blockedNoFit'), {
            target: formatByteLimit(targetBytes, mark),
            min: formatStorageBytes(refused.minBytes, 'up', mark),
            duration: formatTimecode(refused.maxDurationUs),
          })
        : null;

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.kucult.title"
      fileTag="kucuk"
      // Nothing to download unless the file would really come out smaller: an
      // impossible target and a video that already fits are both said here,
      // before the save dialog.
      recipe={video && selectedState === 'shrinks' ? state.project : null}
      exportExtras={extras}
      blockedText={blockedText}
      openVideo={async (file) => {
        const outcome = await state.importVideo(file, ownSizeRecipe);
        if (outcome.kind !== 'opened') return false;
        // The video's own frame: nothing of the picture is cut off.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        setPicked(null);
        return true;
      }}
    >
      {(info) =>
        video ? (
          <>
            <SizeChoice
              info={info}
              videoBytes={videoBytes}
              recipeKey={recipeKey}
              choice={choice}
              onChoice={setPicked}
              previews={current}
              onPreviews={onPreviews}
            />
            <p className="wizard-hint">{t('wizard.kucult.note')}</p>
          </>
        ) : null
      }
    </WizardFlow>
  );
}

// ---------------------------------------------------------------- Sesini al

/**
 * "Sesini al" (ADR-035): no decision. The whole video's sound as an M4A file
 * (AAC — what phones, computers and browsers play); the picture is not even
 * decoded. A video without sound is told so and nothing can be downloaded.
 */
function SesWizard(host: WizardHostProps) {
  const { state } = host;
  const { video } = state;
  const silent = video?.hasAudio === false;
  return (
    <WizardFlow
      {...host}
      titleKey="wizard.ses.title"
      fileTag="ses"
      recipe={video && !silent ? state.project : null}
      exportExtras={{ output: 'audio' }}
      blockedText={silent ? t('wizard.ses.noSound') : null}
      openVideo={async (file) => (await state.importVideo(file, ownSizeRecipe)).kind === 'opened'}
    >
      <div className="wizard-panel" data-testid="ses-info">
        <p className="wizard-panel-title">{t('wizard.ses.body')}</p>
        <p className="wizard-hint">{t('wizard.ses.keeps')}</p>
      </div>
    </WizardFlow>
  );
}

// ---------------------------------------------------------------- Sesi kapat

/**
 * "Sesi kapat": no decision. The whole video in its own frame and size with
 * its sound switched off. The saved file has NO audio track (not a track of
 * silence): that is what every player shows as a video without sound, it
 * costs no bytes, and it is the file the export already writes — and the
 * tests already measure — for a video that never had sound. Where the fast
 * cut allows (ADR-027) the pictures are copied, not re-encoded, and the
 * result's method line says which it was. A video that has no sound to
 * begin with is told so; there is nothing to download.
 */
function SusturWizard(host: WizardHostProps) {
  const { state } = host;
  const { video, settings } = state;
  const already = video?.hasAudio === false;
  return (
    <WizardFlow
      {...host}
      titleKey="wizard.sustur.title"
      fileTag="sessiz"
      // Only with the sound really switched off: never a download that still has it.
      recipe={video && !already && settings.muted ? state.project : null}
      blockedText={already ? t('wizard.sustur.already') : null}
      preview={video ? <VideoPreview video={video} muted label={t('wizard.sustur.preview')} /> : undefined}
      openVideo={async (file) => {
        const outcome = await state.importVideo(file, soundlessRecipe);
        if (outcome.kind !== 'opened') return false;
        // Nothing of the picture is cut off: a shape between the frames gets bars.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        state.changeVideoMuted(true);
        return true;
      }}
    >
      <div className="wizard-panel" data-testid="sustur-info">
        <p className="wizard-panel-title">{t('wizard.sustur.body')}</p>
        <p className="wizard-hint">{t('wizard.sustur.keeps')}</p>
      </div>
    </WizardFlow>
  );
}

/**
 * Two wizards bring a screen of their own that no other task needs — the transcript panel with its
 * model steps ("Yazıya dök") and the before/after picture with the enhancement preview ("İyileştir").
 * They are separate chunks, loaded with their own page only (10 Oct 2026: every wizard page was
 * carrying both, and the whole editor). `next/dynamic` keeps them in the prerendered HTML and has the
 * page ask for the chunk up front, so nothing appears later than before on those two pages.
 */
const YaziWizard = dynamic<WizardHostProps>(() => import('./YaziWizard'));
const IyilestirWizard = dynamic<WizardHostProps>(() => import('./IyilestirWizard'));

/**
 * The wizard of every task that works today. Enabling a task is one line in
 * `domain/tasks.ts` (`available: true`) and its component here; the type
 * of this table refuses an available task without one.
 */
export const WIZARDS: Record<AvailableTaskId, ComponentType<WizardHostProps>> = {
  kes: KesWizard,
  bosluk: BoslukWizard,
  dikey: DikeyWizard,
  kucult: KucultWizard,
  yazi: YaziWizard,
  muzik: MuzikWizard,
  ses: SesWizard,
  sustur: SusturWizard,
  cevir: CevirWizard,
  iyilestir: IyilestirWizard,
};

