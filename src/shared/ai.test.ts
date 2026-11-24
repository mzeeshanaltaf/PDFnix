import { describe, expect, it } from 'vitest'
import {
  ANSWER_RESERVE,
  chooseContextLength,
  estimateTokens,
  excerptCharBudget,
  isAiContextMode
} from './ai'

describe('estimateTokens', () => {
  it('counts one token per 3.5 characters, rounded up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a')).toBe(1)
    expect(estimateTokens('abcdefg')).toBe(2)
    expect(estimateTokens('x'.repeat(3500))).toBe(1000)
    expect(estimateTokens('x'.repeat(3501))).toBe(1001)
  })
})

describe('chooseContextLength', () => {
  it('keeps a loaded instance that is big enough', () => {
    expect(chooseContextLength({ neededTokens: 5000, loadedContext: 8192, cap: 32768 })).toBe(8192)
    expect(chooseContextLength({ neededTokens: 8192, loadedContext: 8192, cap: 32768 })).toBe(8192)
    // Even one bigger than the cap: it is already loaded, nothing is reloaded.
    expect(chooseContextLength({ neededTokens: 9000, loadedContext: 65536, cap: 32768 })).toBe(
      65536
    )
  })

  it('asks for more when the loaded instance is too small', () => {
    expect(
      chooseContextLength({
        neededTokens: 9000,
        loadedContext: 8192,
        maxContext: 262144,
        cap: 32768
      })
    ).toBe(12288)
  })

  it('rounds up to a multiple of 4,096 when the model is not loaded', () => {
    expect(chooseContextLength({ neededTokens: 1, cap: 32768 })).toBe(4096)
    expect(chooseContextLength({ neededTokens: 4096, cap: 32768 })).toBe(4096)
    expect(chooseContextLength({ neededTokens: 4097, cap: 32768 })).toBe(8192)
    expect(chooseContextLength({ neededTokens: 20000, maxContext: 131072, cap: 32768 })).toBe(20480)
  })

  it('stays within the model maximum and the cap', () => {
    expect(chooseContextLength({ neededTokens: 100000, maxContext: 262144, cap: 32768 })).toBe(
      32768
    )
    expect(chooseContextLength({ neededTokens: 100000, maxContext: 16384, cap: 32768 })).toBe(16384)
    expect(
      chooseContextLength({
        neededTokens: 50000,
        loadedContext: 8192,
        maxContext: 16384,
        cap: 65536
      })
    ).toBe(16384)
    // A maximum below one step still gets one step.
    expect(chooseContextLength({ neededTokens: 3000, maxContext: 2048, cap: 32768 })).toBe(4096)
  })
})

describe('excerptCharBudget', () => {
  it('leaves room for the other text and the answer', () => {
    expect(excerptCharBudget({ contextTokens: 8192, otherTokens: 200 })).toBe(
      Math.floor((8192 - 200 - ANSWER_RESERVE) * 3.5)
    )
  })

  it('is never negative', () => {
    expect(excerptCharBudget({ contextTokens: 4096, otherTokens: 5000 })).toBe(0)
  })
})

describe('isAiContextMode', () => {
  it('accepts only page and document', () => {
    expect(isAiContextMode('page')).toBe(true)
    expect(isAiContextMode('document')).toBe(true)
    expect(isAiContextMode('all')).toBe(false)
    expect(isAiContextMode(undefined)).toBe(false)
  })
})
