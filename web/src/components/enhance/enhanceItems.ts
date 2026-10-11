import type { EnhanceSummary } from '@/domain/enhance';
import type { MessageKey } from '@/i18n/messages';

type T = (key: MessageKey) => string;

/**
 * What the plan changes, as the words of a sentence ("renkler toparlanır, kenarlar keskinleştirilir").
 *
 * In a module of its own: the download card of every wizard says this, and must not bring the
 * before/after picture's component with it (10 Oct 2026, page weight).
 */
export function enhanceItems(t: T, summary: EnhanceSummary, tense: 'will' | 'did'): string[] {
  const items: string[] = [];
  if (summary.light !== 'none') items.push(t(`enhance.${tense}.light.${summary.light}` as MessageKey));
  if (summary.colour) items.push(t(`enhance.${tense}.colour` as MessageKey));
  if (summary.sharpen) items.push(t(`enhance.${tense}.sharpen` as MessageKey));
  if (summary.denoise) items.push(t(`enhance.${tense}.denoise` as MessageKey));
  return items;
}
