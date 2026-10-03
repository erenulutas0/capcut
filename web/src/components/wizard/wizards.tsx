'use client';

import { useMemo, useRef, useState, type ComponentType } from 'react';

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
  musicUnderWholeVideo,
  withMusicDefaults,
  type GapChoice,
} from '@/application/taskRecipes';
import { Icon } from '@/components/Icon';
import { useSilenceAnalysis } from '@/components/editor/useSilenceAnalysis';
import { useHydrated } from '@/components/useHydrated';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import type { AvailableTaskId } from '@/domain/tasks';
import { translator, type MessageKey } from '@/i18n/messages';
import { VideoPreview, WizardFlow, fill, lengthText, type WizardHostProps } from './WizardFlow';

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
        const outcome = await state.importVideo(file, musicUnderWholeVideo);
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

/**
 * The wizard of every task that works today. Enabling a task is one line in
 * `domain/tasks.ts` (`available: true`) and its component here; the type
 * of this table refuses an available task without one.
 */
export const WIZARDS: Record<AvailableTaskId, ComponentType<WizardHostProps>> = {
  kes: KesWizard,
  bosluk: BoslukWizard,
  dikey: DikeyWizard,
  muzik: MuzikWizard,
  cevir: CevirWizard,
};

