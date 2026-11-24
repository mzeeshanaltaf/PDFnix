/** Wording for the Settings dialog's "AI assistant (LM Studio)" section. Pure. */

import type { AiModel, AiServerInfo } from '../../../shared/ai'

/** "8K", "128K", or "10,000" for a size that is not a whole number of K. */
export function shortTokens(tokens: number): string {
  return tokens % 1024 === 0 ? `${tokens / 1024}K` : tokens.toLocaleString('en-US')
}

/** "LM Studio: 3 models (Gemma 4 26B A4B loaded, 8,192 tokens)", or the error. */
export function connectionSummary(info: AiServerInfo): string {
  if (info.error) return info.error.message
  const count = info.models.length
  if (count === 0) {
    return 'LM Studio: no chat models. Download one in LM Studio (Discover tab), then test again.'
  }
  const loaded = info.models
    .filter((model) => model.loadedContext !== undefined)
    .map((model) => `${model.label} loaded, ${model.loadedContext!.toLocaleString('en-US')} tokens`)
  const models = `${count} model${count === 1 ? '' : 's'}`
  return loaded.length > 0
    ? `LM Studio: ${models} (${loaded.join('; ')})`
    : `LM Studio: ${models}, none loaded`
}

/** "Gemma 4 26B A4B · loaded (8K)" or "Gemma 4 26B A4B". */
export function modelOptionLabel(model: AiModel): string {
  return model.loadedContext !== undefined
    ? `${model.label} · loaded (${shortTokens(model.loadedContext)})`
    : model.label
}
