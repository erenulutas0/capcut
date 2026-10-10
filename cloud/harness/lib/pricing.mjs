/**
 * Documented prices of the provider (AssemblyAI), pre-recorded speech-to-text.
 *
 * Source: https://www.assemblyai.com/pricing — read on 2026-10-10.
 * Billing rule: "pro-rated to the exact second of audio processed"; a request
 * that errors is not charged
 * (https://www.assemblyai.com/docs/faq/what-happens-when-i-have-used-all-of-my-free-tier-credits,
 * read on 2026-10-10).
 *
 * These are constants on purpose: nothing here is fetched at run time. When the
 * provider changes a price, change it here together with the date above; the
 * unit test pins the numbers so a silent edit shows up in review.
 */
export const PRICING = Object.freeze({
  provider: 'AssemblyAI',
  source: 'https://www.assemblyai.com/pricing',
  readOn: '2026-10-10',
  currency: 'USD',
  /** USD per hour of audio. */
  models: Object.freeze({
    'universal-3-5-pro': 0.21,
    'universal-2': 0.15,
  }),
  /** USD per hour of audio, added to the model's rate. */
  addOns: Object.freeze({
    speakerLabels: 0.02,
    translation: 0.06,
  }),
});

export const MODELS = Object.freeze(Object.keys(PRICING.models));

/**
 * USD per hour for a request. `models` is the provider's `speech_models` list
 * (first that supports the language is used); the estimate takes the most
 * expensive one, so the estimate is never below what can be billed.
 */
export function hourlyRateUsd({ models, speakerLabels = false, translation = false }) {
  if (!Array.isArray(models) || models.length === 0) throw new Error('hourlyRateUsd: no model given');
  let base = 0;
  for (const model of models) {
    const rate = PRICING.models[model];
    if (rate === undefined) throw new Error(`hourlyRateUsd: no documented price for model "${model}"`);
    base = Math.max(base, rate);
  }
  return base + (speakerLabels ? PRICING.addOns.speakerLabels : 0) + (translation ? PRICING.addOns.translation : 0);
}

/** Cost of `seconds` of audio; partial seconds are counted as a whole second (never under-estimates). */
export function costUsd(seconds, options) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`costUsd: bad duration ${seconds}`);
  return (Math.ceil(seconds) / 3600) * hourlyRateUsd(options);
}

export const formatUsd = (value) => `$${value.toFixed(4)}`;
