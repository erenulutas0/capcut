'use client';

import { useEffect, useMemo, useState } from 'react';

import { ExportWorkerClient } from '@/adapters/export/exportClient';
import { soundFixRecipe } from '@/application/taskRecipes';
import { FailureDetails } from '@/components/FailureDetails';
import { Icon } from '@/components/Icon';
import { downloadRecipe } from '@/domain/kesit';
import { WEB_LOCAL_POLICY } from '@/domain/policy';
import { compileRenderPlan } from '@/domain/renderPlan';
import { levelWord } from '@/domain/soundFix';
import { useT } from '@/i18n/locale';
import type { MessageKey } from '@/i18n/messages';
import { WizardFlow, fill, type WizardHostProps } from './WizardFlow';
import { useListen, useSoundCheck } from './useSoundCheck';

/** A measured number for the tests' data attributes (never shown): to a tenth. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Progress is a share of both passes over the sound. */
function percentOf(done: number, total: number): number | null {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
}

/**
 * ADR-049: would the download copy the source's pictures? Asked of the export
 * worker once per video (its own fast-cut checks, nothing decoded). `null`
 * until it answers, and when it could not tell: the screen then says nothing
 * about the picture rather than promise.
 */
function useCopyCheck(state: WizardHostProps['state']): boolean | null {
  const { video, project, settings } = state;
  const plan = useMemo(() => {
    if (!video) return null;
    const recipe = downloadRecipe(project, { kind: 'all' }, settings);
    const compiled = recipe ? compileRenderPlan(recipe, WEB_LOCAL_POLICY) : null;
    return compiled?.ok ? compiled.plan : null;
  }, [project, settings, video]);
  const key = plan && video ? `${video.fileName}|${video.file.size}|${plan.fingerprint}` : null;
  const [answer, setAnswer] = useState<{ key: string; copy: boolean | null } | null>(null);
  useEffect(() => {
    if (!key || !plan || !video) return undefined;
    let live = true;
    const client = new ExportWorkerClient();
    void client.copyCheck(plan, video.file).then((result) => {
      client.dispose();
      if (live) setAnswer({ key, copy: result ? result.copy : null });
    });
    return () => {
      live = false;
      client.dispose();
    };
  }, [key, plan, video]);
  return answer?.key === key ? answer.copy : null;
}

/**
 * "Sesi düzelt" (ADR-049): quiet or uneven sound made audible and even, on
 * this device. No decision: the sound is measured (twice, as it is and through
 * the chain), the screen says what will happen in plain words — "çok kısık →
 * normal" — with five seconds before and after to listen to, and "İndir"
 * makes the video with the fixed sound, its pictures copied where the fast cut
 * allows (ADR-027; the screen only says "görüntüye dokunulmaz" where the
 * export's own checks say so).
 *
 * A video already at a good level is told so and can still be downloaded. A
 * video without sound, or whose sound is silence, is told so and nothing is
 * offered. The chain does not remove noise, and the screen says that too.
 *
 * The measured gains go with the download only (`ExportExtras.soundFix`); the
 * recipe this card opens does not ask for the fix. Since ADR-050 the editor
 * has its own "Sesi düzelt" setting (the same chain, measured on the editor's
 * mix at download), but this card still offers no "Daha fazla ayar → editörde
 * aç": the editor would open with the setting off, and adding the link is a
 * founder decision (ADR-050, "Kurucu kararları").
 */
export default function DuzeltWizard(host: WizardHostProps) {
  const t = useT();
  const { state } = host;
  const { video } = state;
  const sound = useSoundCheck();
  const copy = useCopyCheck(state);
  const run = sound.run;
  const noSound = video?.hasAudio === false;
  const done = run.status === 'done' ? run : null;
  const verdict = done?.check.verdict ?? null;
  const fix = verdict?.kind === 'fix' ? verdict : null;
  const listen = useListen(done?.listen ?? null);
  const extras = useMemo(() => (done && fix ? { soundFix: done.check.settings } : undefined), [done, fix]);
  const running = run.status === 'running';
  const percent = running ? percentOf(run.framesDone, run.framesTotal) : null;
  const level = (lufs: number) => t(`wizard.duzelt.level.${levelWord(lufs)}` as MessageKey);
  const blockedText = noSound
    ? t('wizard.duzelt.noSound')
    : verdict?.kind === 'silent'
      ? t('wizard.duzelt.silent')
      : null;

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.duzelt.title"
      fileTag={t('file.tag.duzelt')}
      recipe={video && fix ? state.project : null}
      exportExtras={extras}
      // While the sound is being measured, or the measuring failed, there is no "İndir" yet.
      working={video !== null && !noSound && run.status !== 'done'}
      blockedText={blockedText}
      noEditor
      openVideo={async (file) => {
        sound.reset();
        const outcome = await state.importVideo(file, soundFixRecipe);
        if (outcome.kind !== 'opened') return false;
        // The video's own frame: nothing of the picture is cut off.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        state.changeVideoMuted(false);
        if (outcome.hasAudio !== false) sound.start(file, outcome.lengthUs);
        return true;
      }}
    >
      <>
        {running ? (
          <div className="wizard-panel" data-testid="duzelt-listening">
            <p className="wizard-panel-title" role="status">
              {t('wizard.duzelt.listening')}
            </p>
            <div
              className="progress-track"
              role="progressbar"
              aria-label={t('wizard.duzelt.listening')}
              aria-valuemin={0}
              aria-valuemax={100}
              {...(percent === null ? {} : { 'aria-valuenow': percent })}
            >
              <div
                className={percent === null ? 'progress-fill progress-indeterminate' : 'progress-fill'}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
            <p className="wizard-hint">{t('wizard.duzelt.listeningHint')}</p>
            <button type="button" className="btn" onClick={sound.cancel} data-testid="duzelt-stop">
              {t('wizard.duzelt.stop')}
            </button>
          </div>
        ) : null}

        {!noSound && (run.status === 'failed' || run.status === 'canceled') ? (
          <div className="wizard-panel" data-testid="duzelt-problem" data-status={run.status}>
            {/* Stopped by the user is not a failure: said, not alerted. */}
            <p className="wizard-panel-title" role={run.status === 'failed' ? 'alert' : 'status'}>
              {run.status === 'failed' ? t(`wizard.duzelt.failed.${run.reason}` as MessageKey) : t('wizard.duzelt.canceled')}
            </p>
            {run.status === 'failed' ? <FailureDetails t={t} detail={run.detail} testId="duzelt-failed" /> : null}
            {video && !(run.status === 'failed' && run.reason === 'no_audio') ? (
              <div className="wizard-after">
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => sound.start(video.file, video.durationUs)}
                  data-testid="duzelt-retry"
                >
                  {t('wizard.duzelt.retry')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {done && fix ? (
          <div
            className="wizard-panel"
            role="status"
            data-testid="duzelt-summary"
            data-before-lufs={tenth(done.check.before.integratedLufs)}
            data-before-lra={tenth(done.check.before.lraLu)}
            data-after-lufs={tenth(done.check.after.integratedLufs)}
            data-input-gain={done.check.settings.inputGainDb}
            data-output-gain={done.check.settings.outputGainDb}
            data-uneven={fix.uneven}
            data-already-good={fix.alreadyGood}
            data-clipped={fix.clipped}
            data-clipped-share={done.check.before.clippedShare}
            data-copy={copy === null ? '' : String(copy)}
          >
            <p className="wizard-panel-title" data-testid="duzelt-body">
              {copy === true ? t('wizard.duzelt.body') : copy === false ? t('wizard.duzelt.bodyPicture') : t('wizard.duzelt.bodyPending')}
            </p>
            {fix.alreadyGood ? (
              <p className="wizard-note" data-testid="duzelt-already">
                <Icon name="info" />
                <span>{t('wizard.duzelt.already')}</span>
              </p>
            ) : (
              <p className="wizard-panel-big" data-testid="duzelt-change">
                {fill(t('wizard.duzelt.change'), {
                  before: level(done.check.before.integratedLufs),
                  after: level(done.check.after.integratedLufs),
                })}
              </p>
            )}
            {fix.uneven ? (
              <p className="wizard-hint" data-testid="duzelt-uneven">
                {t('wizard.duzelt.uneven')}
              </p>
            ) : null}
            {fix.stillQuiet ? (
              <p className="wizard-hint" data-testid="duzelt-still-quiet">
                {t('wizard.duzelt.stillQuiet')}
              </p>
            ) : null}
            {/* Cut off at full scale in places: the level is fixed, the distortion is not (never said to be). */}
            {fix.clipped ? (
              <p className="wizard-hint" data-testid="duzelt-clipped">
                {t('wizard.duzelt.clipped')}
              </p>
            ) : null}
            <p className="wizard-hint" data-testid="duzelt-keeps">
              {t('wizard.duzelt.keeps')}
            </p>
            {done.listen ? (
              <div className="wizard-listen" role="group" aria-label={t('wizard.duzelt.listen')} data-testid="duzelt-listen">
                <span className="wizard-listen-label">{t('wizard.duzelt.listen')}</span>
                {(['before', 'after'] as const).map((which) => (
                  <button
                    key={which}
                    type="button"
                    className="btn btn-compact"
                    aria-pressed={listen.playing === which}
                    onClick={() => listen.play(which)}
                    data-testid={`duzelt-listen-${which}`}
                  >
                    <Icon name={listen.playing === which ? 'pause' : 'play'} size={16} />
                    {t(which === 'before' ? 'wizard.duzelt.listenBefore' : 'wizard.duzelt.listenAfter')}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    </WizardFlow>
  );
}
