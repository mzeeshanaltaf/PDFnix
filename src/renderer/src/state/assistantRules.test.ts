import { describe, expect, it } from 'vitest'
import type { AiModel } from '../../../shared/ai'
import {
  answerStats,
  canContinue,
  contextNote,
  dividerLabel,
  excerptText,
  pagesLabel,
  reasoningFor,
  resolveModel,
  systemPrompt,
  userPrompt,
  usageLabel,
  type Conversation
} from './assistantRules'

function model(key: string, extra: Partial<AiModel> = {}): AiModel {
  return { key, label: key.toUpperCase(), loadedContexts: [], ...extra }
}

describe('userPrompt', () => {
  it('sends exactly "Simplify <selection>" and "Define <selection>"', () => {
    expect(userPrompt({ action: 'simplify', selection: 'Hyresavtalet sägs upp' })).toBe(
      'Simplify Hyresavtalet sägs upp'
    )
    expect(userPrompt({ action: 'define', selection: ' amortisation\n' })).toBe(
      'Define amortisation'
    )
  })

  it('sends a question alone, or with the selection quoted below it', () => {
    expect(userPrompt({ action: 'ask', question: ' What is due? ' })).toBe('What is due?')
    expect(
      userPrompt({ action: 'ask', question: 'Who signs?', selection: 'Line one\nLine two' })
    ).toBe('Who signs?\n\nSelected text:\n"""\nLine one\nLine two\n"""')
  })
})

describe('systemPrompt', () => {
  it('names the program, the file, the pages and the rules, then the excerpt', () => {
    const prompt = systemPrompt('--- Page 3 ---\nHello', 'letter.pdf', 'page 3')
    expect(prompt).toContain('PDFnix, a PDF reader')
    expect(prompt).toContain('"letter.pdf"')
    expect(prompt).toContain('Always answer "Simplify" and "Define" requests in English')
    expect(prompt).toContain('Answer any other question in the language the user wrote it in')
    expect(prompt).toContain('concise')
    expect(prompt).toContain('Markdown')
    expect(prompt).toContain("doesn't contain the answer")
    expect(prompt).toContain('Document excerpt (page 3)')
    expect(prompt.endsWith('"""\n--- Page 3 ---\nHello\n"""')).toBe(true)
    expect(prompt).not.toContain('Only part of the document')
  })

  it('asks for page citations, with exact quotes, only from the excerpt', () => {
    const prompt = systemPrompt('--- Page 3 ---\nHello', 'letter.pdf', 'page 3')
    expect(prompt).toContain('[p. N]')
    expect(prompt).toContain('[p. N: "exact words"]')
    expect(prompt).toContain('never general knowledge')
    // The rules come before the excerpt, which stays last.
    expect(prompt.indexOf('[p. N]')).toBeLessThan(prompt.indexOf('Document excerpt'))
  })

  it('says when part of the document was left out', () => {
    const prompt = systemPrompt('text', 'long.pdf', 'pages 1–12 of 40', true)
    expect(prompt).toContain('Document excerpt (pages 1–12 of 40)')
    expect(prompt).toContain('Only part of the document fits here')
  })

  it('says there is no text when the pages have none', () => {
    const prompt = systemPrompt('  ', 'scan.pdf', 'page 2')
    expect(prompt).toContain('There is no excerpt: page 2 has no text')
    expect(prompt).not.toContain('"""')
    expect(prompt).not.toContain('[p. N]')
  })
})

describe('answerStats', () => {
  it('shows time to first token, speed and tokens as LM Studio reports them', () => {
    expect(
      answerStats({
        inputTokens: 65,
        outputTokens: 1234,
        reasoningTokens: 0,
        tokensPerSecond: 56.19986716395035,
        timeToFirstTokenSeconds: 0.531
      }).map((part) => part.label)
    ).toEqual(['0.53 s TTFT', '56.2 tok/s', '1,234 tokens'])
  })

  it('adds the load time when the model was loaded for the answer', () => {
    const parts = answerStats({ timeToFirstTokenSeconds: 14.4, modelLoadSeconds: 12.2 })
    expect(parts.map((part) => part.label)).toEqual(['14 s TTFT', 'loaded in 12 s'])
  })

  it('says how many of the tokens were reasoning, in the tooltip', () => {
    const [tokens] = answerStats({ outputTokens: 300, reasoningTokens: 120 })
    expect(tokens.title).toBe('Tokens in the answer, 120 reasoning')
  })

  it('shows nothing without stats', () => {
    expect(answerStats(undefined)).toEqual([])
    expect(answerStats({})).toEqual([])
  })
})

describe('usageLabel', () => {
  it('gives the numbers and the share used', () => {
    expect(usageLabel({ used: 886, total: 262144 })).toEqual({
      text: '886 / 262,144',
      fraction: 886 / 262144
    })
    expect(usageLabel({ used: 5000, total: 4096 }).fraction).toBe(1)
  })
})

describe('page labels and excerpts', () => {
  it('labels what the excerpt holds', () => {
    expect(pagesLabel({ mode: 'page', pages: [2], pageCount: 40 })).toBe('page 3')
    expect(pagesLabel({ mode: 'document', pages: [0, 1, 2], pageCount: 3 })).toBe('all 3 pages')
    expect(pagesLabel({ mode: 'document', pages: [0, 1, 2], pageCount: 40 })).toBe(
      'pages 1–3 of 40'
    )
    expect(pagesLabel({ mode: 'document', pages: [0], pageCount: 40 })).toBe('page 1')
  })

  it('marks each page with its 1-based number and skips empty pages', () => {
    expect(
      excerptText([
        { index: 0, text: 'One' },
        { index: 1, text: '' },
        { index: 2, text: 'Three\n' }
      ])
    ).toBe('--- Page 1 ---\nOne\n\n--- Page 3 ---\nThree')
  })

  it('notes a cut document, a cut page and pages without text', () => {
    const pages = [
      { index: 0, text: 'a' },
      { index: 11, text: 'b' }
    ]
    expect(contextNote({ mode: 'document', pages, pageCount: 40, truncated: true })).toBe(
      'Pages 1–12 of 40 included'
    )
    expect(contextNote({ mode: 'document', pages, pageCount: 40, truncated: false })).toBeNull()
    expect(
      contextNote({ mode: 'page', pages: [{ index: 4, text: 'x' }], pageCount: 9, truncated: true })
    ).toBe('Only the start of this page fits in the context.')
    expect(
      contextNote({
        mode: 'page',
        pages: [{ index: 4, text: ' ' }],
        pageCount: 9,
        truncated: false
      })
    ).toBe('This page has no text. Run Tools → Recognise Text (OCR) first.')
  })

  it('labels a divider with the context and the model', () => {
    expect(dividerLabel('document', 0, 'Gemma 4')).toBe(
      'New conversation · Whole document · Gemma 4'
    )
    expect(dividerLabel('page', 4, 'Gemma 4')).toBe('New conversation · Page 5 · Gemma 4')
  })
})

describe('canContinue', () => {
  const conversation: Conversation = {
    responseId: 'resp_1',
    model: 'gemma',
    contextMode: 'page',
    page: 2,
    contextLength: 8192,
    revision: 5
  }
  const same = { model: 'gemma', contextMode: 'page' as const, page: 2, revision: 5 }

  it('continues with the same model, mode, page and revision', () => {
    expect(canContinue(conversation, same)).toBe(true)
  })

  it('starts a new conversation when anything changed', () => {
    expect(canContinue(null, same)).toBe(false)
    expect(canContinue(conversation, { ...same, model: 'qwen' })).toBe(false)
    expect(canContinue(conversation, { ...same, contextMode: 'document' })).toBe(false)
    expect(canContinue(conversation, { ...same, page: 3 })).toBe(false)
    expect(canContinue(conversation, { ...same, revision: 6 })).toBe(false)
  })

  it('ignores the page in document mode', () => {
    const whole = { ...conversation, contextMode: 'document' as const }
    expect(canContinue(whole, { ...same, contextMode: 'document', page: 7 })).toBe(true)
  })
})

describe('resolveModel', () => {
  const models = [model('a'), model('b', { loadedContext: 8192 }), model('c')]

  it('uses the chosen model when LM Studio still has it', () => {
    expect(resolveModel(models, 'c')).toEqual({ model: models[2], stale: false })
  })

  it('otherwise takes the first loaded model, else the first', () => {
    expect(resolveModel(models, null)).toEqual({ model: models[1], stale: false })
    expect(resolveModel(models, 'gone')).toEqual({ model: models[1], stale: true })
    expect(resolveModel([model('x'), model('y')], null)?.model.key).toBe('x')
    expect(resolveModel([], 'a')).toBeNull()
  })

  it('turns reasoning off only where the model allows it', () => {
    expect(reasoningFor(model('g', { reasoningOptions: ['off', 'on'] }))).toBe('off')
    expect(reasoningFor(model('h', { reasoningOptions: ['low', 'high'] }))).toBeUndefined()
    expect(reasoningFor(model('i'))).toBeUndefined()
  })
})
