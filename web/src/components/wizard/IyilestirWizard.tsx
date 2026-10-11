'use client';

import { useMemo, useState } from 'react';

import { enhanceRecipe } from '@/application/taskRecipes';
import { BeforeAfter } from '@/components/enhance/BeforeAfter';
import { enhanceItems } from '@/components/enhance/enhanceItems';
import { EnhanceSlowNotice } from '@/components/enhance/SlowNotice';
import { useEnhancePreview } from '@/components/enhance/useEnhancePreview';
import { Icon } from '@/components/Icon';
import { ENHANCE_STRENGTHS_V4 } from '@/domain/edl';
import { translator, type MessageKey } from '@/i18n/messages';
import { ChoiceOption } from './ChoiceOption';
import { WizardFlow, type WizardHostProps } from './WizardFlow';

const t = translator('tr');

/**
 * "İyileştir" (ADR-037): light, colour, sharpness and noise of the whole
 * video, cleaned up on this device. One choice — how strongly, "Otomatik"
 * chosen — next to a before/after of a real frame of the user's video, made
 * by the export's own code. It says what it will do, and when there is
 * nothing to do it says so and does not offer a download that would change
 * nothing.
 *
 * The strength is written into the recipe (`enhance`), so "Daha fazla ayar →
 * editörde aç" continues with it switched on, where Ayarlar → Görüntü shows
 * the same setting.
 */
export default function IyilestirWizard(host: WizardHostProps) {
  const { state } = host;
  const { video, project, settings } = state;
  const [shot, setShot] = useState(0);
  const strength = project.enhance?.strength ?? null;
  const preview = useEnhancePreview({ project, settings, videoFile: video?.file ?? null, shot });
  // The picture of the strength chosen now; while another strength is being prepared the old picture stays
  // on screen, but its summary is not shown and nothing can be downloaded with it.
  const picture = preview.current && preview.state.status === 'ready' ? preview.state.picture : null;
  const shown =
    preview.state.status === 'ready' ? true : preview.state.status === 'loading' ? preview.state.previous !== null : false;
  const failed = preview.state.status === 'failed';
  const nothing = picture?.summary.nothing === true;
  const items = picture && !nothing ? enhanceItems(t, picture.summary, 'will') : [];
  const extras = useMemo(() => (preview.analysis ? { enhanceAnalysis: preview.analysis } : undefined), [preview.analysis]);

  return (
    <WizardFlow
      {...host}
      titleKey="wizard.iyilestir.title"
      fileTag="iyilestirilmis"
      // Nothing to download until the video has been looked at, and nothing when nothing would change.
      recipe={video && strength && picture && !nothing ? project : null}
      exportExtras={extras}
      // While the video is being looked at for the first time there is no "İndir" yet.
      working={video !== null && !shown && !failed}
      blockedText={nothing ? t('wizard.iyilestir.nothingBlocked') : null}
      preview={
        <BeforeAfter
          t={t}
          state={preview.state}
          onOtherFrame={() => setShot((value) => value + 1)}
          onRetry={preview.retry}
        />
      }
      openVideo={async (file) => {
        const outcome = await state.importVideo(file, enhanceRecipe);
        if (outcome.kind !== 'opened') return false;
        // The video's own frame: nothing of the picture is cut off.
        state.changeFraming({ fit: 'contain', zoom: 1 });
        setShot(0);
        return true;
      }}
    >
      {({ busy }) => (
        <>
          <div className="wizard-panel" data-testid="iyilestir-info">
            <p className="wizard-panel-title">{t('wizard.iyilestir.body')}</p>
            <p className="wizard-hint">{t('wizard.iyilestir.keeps')}</p>
            {picture ? (
              <p
                className="wizard-note"
                role="status"
                data-testid="iyilestir-summary"
                data-nothing={nothing}
                data-light={picture.summary.light}
                data-colour={picture.summary.colour}
                data-sharpen={picture.summary.sharpen}
                data-denoise={picture.summary.denoise}
              >
                <Icon name={nothing ? 'info' : 'check'} />
                <span>{nothing ? t('wizard.iyilestir.nothing') : `${t('enhance.will.title')} ${items.join(', ')}.`}</span>
              </p>
            ) : null}
            <EnhanceSlowNotice t={t} picture={picture} className="wizard-hint" testId="iyilestir-slow" />
          </div>
          <fieldset className="wizard-choice" data-testid="iyilestir-choice">
            <legend>{t('wizard.iyilestir.choice')}</legend>
            {ENHANCE_STRENGTHS_V4.map((value) => (
              <ChoiceOption
                key={value}
                name="enhance-strength"
                value={value}
                checked={strength === value}
                disabled={busy}
                onSelect={() => state.changeEnhance(value)}
                label={t(`wizard.iyilestir.${value}` as MessageKey)}
                hint={t(`wizard.iyilestir.${value}Hint` as MessageKey)}
              />
            ))}
          </fieldset>
        </>
      )}
    </WizardFlow>
  );
}
