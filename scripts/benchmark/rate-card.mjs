// Published OpenRouter rate cards used when a run's provider route is discounted or free.
// Values are USD per token; OpenRouter publishes the rates per million tokens.
const GLM_53_FLASH_RATES = Object.freeze({
  input: 0.15 / 1_000_000,
  output: 0.50 / 1_000_000,
  cacheRead: 0.03 / 1_000_000,
});

export const RATE_CARD_MODELS = new Set([
  'thinkingmachines/inkling:free',
  'stealth/ox-alpha',
  'z-ai/glm-5.3-flash',
]);

const MODEL_RATES = new Map([
  ['stealth/ox-alpha', GLM_53_FLASH_RATES],
  ['z-ai/glm-5.3-flash', GLM_53_FLASH_RATES],
]);

// Replace a provider-reported cost for any model with its published rate-card value. Token counts
// remain the recorded usage; only the dollar figure changes. Models without an override keep the
// provider-reported figure.
export function applyRateCard(summary) {
  const models = summary.models.map((model) => {
    const rates = MODEL_RATES.get(model.modelName);
    if (!rates) return model;
    const costUsd = model.inputTokens * rates.input
      + model.outputTokens * rates.output
      + model.cacheReadTokens * rates.cacheRead;
    return { ...model, costUsd };
  });

  if (!models.some((model, index) => model !== summary.models[index])) return summary;
  if (!models.every((model) => typeof model.costUsd === 'number' && Number.isFinite(model.costUsd))) return { ...summary, models };
  return {
    ...summary,
    totalUsd: models.reduce((total, model) => total + model.costUsd, 0),
    models,
  };
}

export function rateCardCost({ inputTokens = 0, outputTokens = 0, cacheReadTokens = 0 }, modelName = 'z-ai/glm-5.3-flash') {
  const rates = MODEL_RATES.get(modelName);
  if (!rates) throw new Error(`No rate card for ${modelName}.`);
  return inputTokens * rates.input + outputTokens * rates.output + cacheReadTokens * rates.cacheRead;
}
