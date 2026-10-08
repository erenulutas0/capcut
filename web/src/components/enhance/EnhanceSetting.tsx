'use client';

import { useState } from 'react';

import { ENHANCE_STRENGTHS_V4, type EnhanceStrengthV4, type Project } from '@/domain/edl';
import type { KesitSettings } from '@/domain/kesit';
import type { MessageKey } from '@/i18n/messages';
import { BeforeAfter, enhanceItems } from './BeforeAfter';
import { EnhanceSlowNotice } from './SlowNotice';
import { useEnhancePreview } from './useEnhancePreview';

interface Props {
  t: (key: MessageKey) => string;
  project: Project;
  settings: KesitSettings;
  videoFile: File | null;
  /** The drawer is open on this tab: only then is the video looked at. */
  active: boolean;
  onChange: (strength: EnhanceStrengthV4 | null) => void;
}

/**
 * Ayarlar → Görüntü → "Görüntüyü iyileştir" (ADR-037): the same setting the
 * "İyileştir" wizard writes into the recipe, for every download of the
 * editor. Off by default.
 *
 * The player keeps showing the video as it is (it is the browser's own
 * `<video>`), so the setting says so and shows what the download will look
 * like instead: a before/after of a real frame, made by the export's code.
 */
export function EnhanceSetting({ t, project, settings, videoFile, active, onChange }: Props) {
  const [shot, setShot] = useState(0);
  const strength = project.enhance?.strength ?? null;
  const preview = useEnhancePreview({ project, settings, videoFile, shot, enabled: active && strength !== null });
  const picture = preview.current && preview.state.status === 'ready' ? preview.state.picture : null;

  return (
    <div className="enhance-setting" data-testid="enhance-setting">
      <hr className="divider" />
      <label className="field-label" htmlFor="enhance-strength">
        {t('enhance.setting.label')}
      </label>
      <select
        id="enhance-strength"
        className="select"
        value={strength ?? 'off'}
        onChange={(event) => {
          const value = event.target.value;
          onChange((ENHANCE_STRENGTHS_V4 as readonly string[]).includes(value) ? (value as EnhanceStrengthV4) : null);
        }}
        aria-describedby="enhance-strength-hint"
        data-testid="enhance-strength"
      >
        <option value="off">{t('enhance.setting.off')}</option>
        {ENHANCE_STRENGTHS_V4.map((value) => (
          <option key={value} value={value}>
            {t(`wizard.iyilestir.${value}` as MessageKey)}
          </option>
        ))}
      </select>
      <p className="hint-small" id="enhance-strength-hint">
        {t('enhance.setting.hint')}
      </p>
      {strength && videoFile ? (
        <>
          <p className="hint-small">{t('enhance.setting.previewNote')}</p>
          <BeforeAfter
            t={t}
            state={preview.state}
            onOtherFrame={() => setShot((value) => value + 1)}
            onRetry={preview.retry}
            compact
          />
          {picture ? (
            <p className="hint-small" role="status" data-testid="enhance-setting-summary" data-nothing={picture.summary.nothing}>
              {picture.summary.nothing
                ? t('wizard.iyilestir.nothing')
                : `${t('enhance.will.title')} ${enhanceItems(t, picture.summary, 'will').join(', ')}.`}
            </p>
          ) : null}
          <EnhanceSlowNotice t={t} picture={picture} className="hint-small" testId="enhance-setting-slow" />
        </>
      ) : null}
    </div>
  );
}
