import { describe, expect, it } from 'vitest'
import type { AiModel } from '../../../shared/ai'
import { connectionSummary, modelOptionLabel, shortTokens } from './aiSettings'

const gemma: AiModel = {
  key: 'google/gemma-4-26b-a4b',
  label: 'Gemma 4 26B A4B',
  maxContext: 262144,
  loadedContext: 8192,
  loadedContexts: [8192]
}
const qwen: AiModel = { key: 'qwen/qwen3-8b', label: 'Qwen3 8B', loadedContexts: [] }
const url = 'http://127.0.0.1:1234'

describe('AI settings wording', () => {
  it('shortens token counts', () => {
    expect(shortTokens(8192)).toBe('8K')
    expect(shortTokens(131072)).toBe('128K')
    expect(shortTokens(10000)).toBe('10,000')
  })

  it('summarises the connection', () => {
    expect(connectionSummary({ reachable: true, url, models: [gemma, qwen] })).toBe(
      'LM Studio: 2 models (Gemma 4 26B A4B loaded, 8,192 tokens)'
    )
    expect(connectionSummary({ reachable: true, url, models: [qwen] })).toBe(
      'LM Studio: 1 model, none loaded'
    )
    expect(connectionSummary({ reachable: true, url, models: [] })).toMatch(/no chat models/)
    expect(
      connectionSummary({
        reachable: false,
        url,
        models: [],
        error: { code: 'unreachable', message: "LM Studio's server isn't running." }
      })
    ).toBe("LM Studio's server isn't running.")
  })

  it('marks loaded models in the model list', () => {
    expect(modelOptionLabel(gemma)).toBe('Gemma 4 26B A4B · loaded (8K)')
    expect(modelOptionLabel(qwen)).toBe('Qwen3 8B')
  })
})
