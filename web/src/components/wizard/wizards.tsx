'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { safeFileName } from '@/adapters/browserMedia';
import { applySilenceCuts, withWholeKesit } from '@/application/commands';
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
import { Icon } from '@/components/Icon';
import { TranscribeSteps } from '@/components/transcript/TranscribeSteps';
import { TranscriptDownloads } from '@/components/transcript/TranscriptDownloads';
import { TranscriptPanel } from '@/components/transcript/TranscriptPanel';
import { useTranscription } from '@/components/transcript/useTranscription';
import { primaryCaptionTrack } from '@/domain/captions';
import { transcriptLines } from '@/domain/transcript';
import type { TargetSizePreview } from '@/components/editor/useDownloads';
import { useSilenceAnalysis } from '@/components/editor/useSilenceAnalysis';
import { useHydrated } from '@/components/useHydrated';
import { formatStorageBytes } from '@/domain/outputStorage';
import { WEB_LOCAL_POLICY, formatByteLimit, formatBytes } from '@/domain/policy';
import { SIZE_PRESETS, type SizePresetId, type TargetSizeRequest } from '@/domain/targetSize';
import type { AvailableTaskId } from '@/domain/tasks';
import { formatTimecode } from '@/domain/time';
import { translator, type MessageKey } from '@/i18n/messages';
import { VideoPreview, WizardFlow, fill, lengthText, type FlowInfo, type WizardHostProps } from './WizardFlow';

const t = translator('tr');

/** Envelope frames are 10 ms; progress is a share of the video. */
function percentOf(done: number, total: number): number | null {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
}

/** One of the two big options of a wizard's decision: a real radio button. */
function ChoiceOption({
  name,
  value,
  checked,
  disabled,
  onSelect,
  label,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="wizard-option" data-checked={checked}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        data-testid={`option-${value}`}
      />
      <span className="wizard-option-text">
        <span className="wizard-option-label">{label}</span>
        <span className="wizard-option-hint">{hint}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- Kes

/**
 * "Kes": the kesit editor IS this task (ADR-026/030). The wizard only picks
 * the video; the editor opens over it at once, first-run hint included.
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
        const outcome = await state.importVideo(file);
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
                <button type="button" className="btn" onClick={host.onOpenEditor} data-testid="bosluk-open-editor">
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
                <button type="button" className="btn" onClick={host.onOpenEditor} data-testid="bosluk-open-editor">
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
 * "Dikey yap": the 9:16 frame of Reels / TikTok / Shorts (1080 × 1920, the
 * editor's default size). One choice: fill the frame (the sides are cut) or
 * fit the whole picture (empty space remains), shown live in the frame.
 */
function DikeyWizard(host: WizardHostProps) {
  const { state } = host;
  const { video } = state;
  const fit = state.settings.fit;
  const vertical = state.project.canvas.aspect === '9:16';
  const already = video !== null && (video.displayWidth ?? 0) * 16 === (video.displayHeight ?? 0) * 9;

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
              {t('wizard.dikey.already')}
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
          {already ? null : <p className="wizard-hint">{t('wizard.dikey.note')}</p>}
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

/** The order the choices are shown in: the roomiest first (it is the default). */
const SIZE_CHOICES: readonly SizePresetId[] = ['share', 'email', 'whatsapp'];

type SizePreviews = Partial<Record<SizePresetId, TargetSizePreview>>;

/**
 * What one size would give, said before anything is encoded (ADR-035):
 * "≈ 48 MB · 720p", "already fits", or the honest "does not fit" with the
 * smallest size that would.
 */
function sizeHint(preview: TargetSizePreview | undefined, videoBytes: number, targetBytes: number): string {
  const mark = t('time.decimalMark');
  if (!preview) return t('wizard.kucult.calculating');
  if (!preview.ok) {
    return preview.reason === 'target_too_small'
      ? fill(t('wizard.kucult.tooSmall'), { min: formatStorageBytes(preview.refusal.minBytes, 'up', mark) })
      : t('wizard.kucult.calculating');
  }
  // The file itself is already under the limit: its pictures are kept where they can be.
  if (videoBytes <= targetBytes) {
    return fill(t('wizard.kucult.alreadyFits'), { size: formatBytes(videoBytes, mark) });
  }
  const { decision } = preview;
  const values = {
    size: formatBytes(decision.plannedBytes, mark),
    height: String(decision.shortEdge),
    seconds: String(preview.estimatedSeconds),
  };
  return fill(t(decision.mode === 'normal' ? 'wizard.kucult.planNormal' : 'wizard.kucult.plan'), values);
}

/**
 * The size choice of "Küçült". The three previews are asked once per video
 * (the planner is pure arithmetic plus one question to the browser about its
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
  choice: SizePresetId;
  onChoice: (id: SizePresetId) => void;
  previews: SizePreviews;
  onPreviews: (key: string, previews: SizePreviews) => void;
}) {
  const { previewSize } = info;
  useEffect(() => {
    let live = true;
    void Promise.all(
      SIZE_PRESETS.map(async (preset) => [preset.id, await previewSize({ targetBytes: preset.bytes })] as const),
    ).then((entries) => {
      if (live) onPreviews(recipeKey, Object.fromEntries(entries) as SizePreviews);
    });
    return () => {
      live = false;
    };
    // `previewSize` follows the recipe; the key says when the video changed.
  }, [previewSize, recipeKey, onPreviews]);

  return (
    <fieldset className="wizard-choice" data-testid="kucult-choice">
      <legend>{t('wizard.kucult.choice')}</legend>
      {SIZE_CHOICES.map((id) => {
        const preset = SIZE_PRESETS.find((item) => item.id === id);
        if (!preset) return null;
        const preview = previews[id];
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
                data-state={!preview ? 'pending' : preview.ok ? (videoBytes <= preset.bytes ? 'already' : preview.decision.mode) : 'refused'}
                data-planned-bytes={preview?.ok ? preview.decision.plannedBytes : undefined}
                data-short-edge={preview?.ok ? preview.decision.shortEdge : undefined}
                data-min-bytes={preview && !preview.ok && preview.reason === 'target_too_small' ? preview.refusal.minBytes : undefined}
              >
                {sizeHint(preview, videoBytes, preset.bytes)}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * "Küçült" (ADR-035): the whole video at or under a size. One choice — where
 * it has to fit (share sheet, e-mail, WhatsApp) — and every option says what
 * it would give before "İndir": the expected size and resolution, that the
 * video already fits, or that it cannot fit and what the smallest size is.
 * The result line then says what the saved file really weighs.
 */
function KucultWizard(host: WizardHostProps) {
  const { state } = host;
  const { video } = state;
  const [choice, setChoice] = useState<SizePresetId>('share');
  const [previews, setPreviews] = useState<{ key: string; previews: SizePreviews }>({ key: '', previews: {} });
  const onPreviews = useCallback((key: string, next: SizePreviews) => setPreviews({ key, previews: next }), []);
  const recipeKey = video ? `${video.fileName}|${video.file.size}|${video.durationUs}|${state.project.export.shortEdge}` : '';
  const current = previews.key === recipeKey ? previews.previews : {};
  const preset = SIZE_PRESETS.find((item) => item.id === choice) ?? SIZE_PRESETS[0];
  const selected = current[choice];
  const refused = selected && !selected.ok && selected.reason === 'target_too_small' ? selected.refusal : null;
  const request: TargetSizeRequest | null = preset ? { targetBytes: preset.bytes } : null;
  const mark = t('time.decimalMark');

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.kucult.title"
      fileTag="kucuk"
      // Nothing to download while the size is not known to fit: an impossible
      // target is refused here, before the save dialog.
      recipe={video && selected?.ok ? state.project : null}
      exportExtras={request ? { targetSize: request } : undefined}
      blockedText={
        refused && preset
          ? fill(t(refused.maxDurationUs >= 1_000_000 ? 'wizard.kucult.blocked' : 'wizard.kucult.blockedNoFit'), {
              target: formatByteLimit(preset.bytes, mark),
              min: formatStorageBytes(refused.minBytes, 'up', mark),
              duration: formatTimecode(refused.maxDurationUs),
            })
          : null
      }
      openVideo={async (file) => {
        const outcome = await state.importVideo(file, ownSizeRecipe);
        if (outcome.kind !== 'opened') return false;
        // The video's own frame: nothing of the picture is cut off.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        setChoice('share');
        return true;
      }}
    >
      {(info) =>
        video ? (
          <>
            <SizeChoice
              info={info}
              videoBytes={video.file.size}
              recipeKey={recipeKey}
              choice={choice}
              onChoice={setChoice}
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

// ---------------------------------------------------------------- Yazıya dök

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
function YaziWizard(host: WizardHostProps) {
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
};

