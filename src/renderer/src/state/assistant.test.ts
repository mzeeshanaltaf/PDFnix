import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiChatRequest,
  AiEvent,
  AiEventMessage,
  AiModel,
  AiServerInfo
} from '../../../shared/ai'
import type { UserSettings } from '../../../shared/api'
import type { OpenedDocument, PlainText } from '../api/engine'

const engineMock = vi.hoisted(() => ({
  plainText: vi.fn(),
  setRecoveryDelay: vi.fn(async () => undefined)
}))
vi.mock('@/api/engine', () => ({ engine: engineMock }))

import {
  askAssistant,
  chatOf,
  clearAssistant,
  forgetAssistant,
  resetAssistant,
  retryAssistant,
  setContextMode,
  setModel,
  stopAssistant,
  useAssistant,
  type AnswerItem
} from './assistant'
import { useSettings } from './settings'
import { useTabs } from './tabs'

// --- fakes -------------------------------------------------------------------------

const GEMMA: AiModel = {
  key: 'google/gemma-4',
  label: 'Gemma 4',
  maxContext: 131072,
  loadedContext: 8192,
  loadedContexts: [8192],
  reasoningOptions: ['off', 'on'],
  reasoningDefault: 'on'
}
const QWEN: AiModel = { key: 'qwen/qwen3', label: 'Qwen 3', maxContext: 32768, loadedContexts: [] }

function serverWith(models: AiModel[]): AiServerInfo {
  return { reachable: true, url: 'http://127.0.0.1:1234', models }
}

/** A chat call the test answers by hand. */
interface Call {
  request: AiChatRequest
  emit: (event: AiEvent) => void
  finish: (event: AiEvent) => void
}

let listener: ((event: AiEventMessage) => void) | null = null
let calls: Call[] = []
let settings: UserSettings

const ai = {
  listModels: vi.fn<() => Promise<AiServerInfo>>(),
  chat: vi.fn<(request: AiChatRequest) => Promise<AiEvent>>(),
  cancel: vi.fn<(requestId: string) => void>(),
  onEvent: vi.fn((next: (event: AiEventMessage) => void) => {
    listener = next
    return () => {
      listener = null
    }
  })
}

function opened(pageCount = 3): OpenedDocument {
  return {
    docId: 'doc-1',
    path: 'C:\\Docs\\letter.pdf',
    fileName: 'letter.pdf',
    pageCount,
    pages: Array.from({ length: pageCount }, () => ({ width: 612, height: 792, rotation: 0 })),
    title: '',
    isEncrypted: false,
    hasTextLayer: true,
    revision: 4,
    canUndo: false,
    canRedo: false,
    undoName: null,
    redoName: null,
    modified: false
  }
}

function pages(from: number, to: number): PlainText['pages'] {
  return Array.from({ length: to - from + 1 }, (_, offset) => ({
    index: from + offset,
    text: `Text of page ${from + offset + 1}.`
  }))
}

let tabId = ''

beforeEach(() => {
  calls = []
  listener = null
  settings = {
    authorName: '',
    highlightColor: '#ffeb3b',
    defaultZoom: 'actual-size',
    defaultLayout: 'continuous',
    ocrLanguages: ['eng'],
    recoveryMinutes: 2,
    scanCodes: true,
    aiServerUrl: 'http://127.0.0.1:1234',
    aiModel: null,
    aiContext: 'page',
    aiMaxContext: 32768
  }
  ai.listModels.mockImplementation(async () => serverWith([GEMMA, QWEN]))
  ai.chat.mockImplementation(
    (request) =>
      new Promise<AiEvent>((resolve) => {
        const call: Call = {
          request,
          emit: (event) => listener?.({ ...event, requestId: request.requestId }),
          finish: (event) => {
            listener?.({ ...event, requestId: request.requestId })
            resolve(event)
          }
        }
        calls.push(call)
      })
  )
  ai.cancel.mockImplementation((requestId) => {
    calls
      .find((call) => call.request.requestId === requestId)
      ?.finish({
        type: 'done',
        cancelled: true
      })
  })
  engineMock.plainText.mockImplementation(
    async (_docId: string, options: { from: number; to: number; maxChars: number }) => ({
      pages: pages(options.from, options.to),
      pageCount: useTabs.getState().tabs[0]?.pageCount ?? 3,
      truncated: false
    })
  )
  vi.stubGlobal('window', {
    api: {
      ai,
      settings: {
        set: vi.fn(async (patch: Partial<UserSettings>) => {
          settings = { ...settings, ...patch }
          return settings
        })
      }
    }
  })
  useSettings.setState({ ...settings })
  useTabs.setState({ tabs: [], activeTabId: null })
  tabId = useTabs.getState().addTab(opened())
  resetAssistant()
})

afterEach(() => {
  resetAssistant()
})

/** Waits until `count` chat requests have been made, and returns the last. */
async function nthCall(count: number): Promise<Call> {
  await vi.waitFor(() => expect(calls).toHaveLength(count))
  return calls[count - 1]
}

function answers(): AnswerItem[] {
  return chatOf(tabId).items.filter((item): item is AnswerItem => item.kind === 'assistant')
}

function lastAnswer(): AnswerItem {
  const all = answers()
  return all[all.length - 1]
}

// --- tests -------------------------------------------------------------------------

describe('assistant store', () => {
  it('sends Simplify with the page as context and shows the answer as it streams', async () => {
    const asked = askAssistant(tabId, { action: 'simplify', selection: 'Hard words', page: 1 })
    const call = await nthCall(1)

    expect(call.request).toMatchObject({
      model: 'google/gemma-4',
      input: 'Simplify Hard words',
      reasoning: 'off',
      contextLength: 8192
    })
    expect(call.request.previousResponseId).toBeUndefined()
    expect(call.request.systemPrompt).toContain('--- Page 2 ---\nText of page 2.')
    expect(call.request.systemPrompt).toContain('"letter.pdf"')
    expect(engineMock.plainText).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ from: 1, to: 1 })
    )
    expect(chatOf(tabId).streaming).toBe(true)

    call.emit({ type: 'status', stage: 'loading', progress: 0.4 })
    expect(lastAnswer().status).toEqual({ stage: 'loading', progress: 0.4 })
    call.emit({ type: 'status', stage: 'reading', progress: 0.7 })
    expect(lastAnswer().status).toEqual({ stage: 'reading', progress: 0.7 })
    call.emit({ type: 'thinking', text: 'hmm' })
    expect(lastAnswer()).toMatchObject({ thinking: true, status: undefined, text: '' })
    call.emit({ type: 'delta', text: 'Easy ' })
    call.emit({ type: 'delta', text: 'words.' })
    expect(lastAnswer()).toMatchObject({ text: 'Easy words.', thinking: false, streaming: true })

    call.finish({ type: 'done', responseId: 'resp_1' })
    await asked
    expect(lastAnswer()).toMatchObject({ text: 'Easy words.', streaming: false })
    expect(chatOf(tabId)).toMatchObject({
      streaming: false,
      requestId: null,
      conversation: {
        responseId: 'resp_1',
        model: 'google/gemma-4',
        contextMode: 'page',
        page: 1,
        contextLength: 8192,
        revision: 4
      }
    })
    const [user] = chatOf(tabId).items
    expect(user).toMatchObject({
      kind: 'user',
      action: 'simplify',
      selection: 'Hard words',
      page: 1
    })
  })

  it('continues a conversation with the previous answer and no system prompt', async () => {
    void askAssistant(tabId, { action: 'define', selection: 'lease', page: 0 })
    ;(await nthCall(1)).finish({ type: 'done', responseId: 'resp_1' })
    await vi.waitFor(() => expect(chatOf(tabId).conversation?.responseId).toBe('resp_1'))

    const followUp = askAssistant(tabId, { action: 'ask', question: 'And in Swedish?' })
    const call = await nthCall(2)
    expect(call.request).toMatchObject({
      input: 'And in Swedish?',
      previousResponseId: 'resp_1',
      contextLength: 8192,
      reasoning: 'off'
    })
    expect(call.request.systemPrompt).toBeUndefined()
    expect(engineMock.plainText).toHaveBeenCalledTimes(1)
    call.finish({ type: 'done', responseId: 'resp_2' })
    await followUp
    expect(chatOf(tabId).conversation?.responseId).toBe('resp_2')
    expect(chatOf(tabId).items.some((item) => item.kind === 'divider')).toBe(false)
  })

  it('starts a new conversation with a divider when the page, mode, model or document changes', async () => {
    const answer = async (count: number): Promise<Call> => {
      const call = await nthCall(count)
      call.finish({ type: 'done', responseId: `resp_${count}` })
      await vi.waitFor(() => expect(chatOf(tabId).streaming).toBe(false))
      return call
    }
    void askAssistant(tabId, { action: 'define', selection: 'a', page: 0 })
    await answer(1)

    void askAssistant(tabId, { action: 'define', selection: 'b', page: 2 })
    expect((await answer(2)).request.previousResponseId).toBeUndefined()

    setContextMode(tabId, 'document')
    expect(settings.aiContext).toBe('document')
    void askAssistant(tabId, { action: 'define', selection: 'c', page: 2 })
    expect((await answer(3)).request.previousResponseId).toBeUndefined()

    useTabs.getState().patchTab(tabId, { revision: 9 })
    void askAssistant(tabId, { action: 'define', selection: 'd', page: 2 })
    expect((await answer(4)).request.previousResponseId).toBeUndefined()

    await setModel('qwen/qwen3')
    void askAssistant(tabId, { action: 'define', selection: 'e', page: 2 })
    const fifth = await answer(5)
    expect(fifth.request).toMatchObject({ model: 'qwen/qwen3' })
    expect(fifth.request.reasoning).toBeUndefined()

    const labels = chatOf(tabId)
      .items.filter((item) => item.kind === 'divider')
      .map((item) => item.label)
    expect(labels).toEqual([
      'New conversation · Page 3 · Gemma 4',
      'New conversation · Whole document · Gemma 4',
      'New conversation · Whole document · Gemma 4',
      'New conversation · Whole document · Qwen 3'
    ])
  })

  it('starts again once when the stored conversation has expired', async () => {
    void askAssistant(tabId, { action: 'define', selection: 'a', page: 0 })
    ;(await nthCall(1)).finish({ type: 'done', responseId: 'resp_1' })
    await vi.waitFor(() => expect(chatOf(tabId).streaming).toBe(false))

    const asked = askAssistant(tabId, { action: 'ask', question: 'More?' })
    const continued = await nthCall(2)
    expect(continued.request.previousResponseId).toBe('resp_1')
    continued.finish({
      type: 'error',
      error: { code: 'conversation_expired', message: 'Expired.' }
    })
    const fresh = await nthCall(3)
    expect(fresh.request.previousResponseId).toBeUndefined()
    expect(fresh.request.systemPrompt).toContain('Text of page 1.')
    expect(fresh.request.input).toBe('More?')
    fresh.emit({ type: 'delta', text: 'Yes.' })
    fresh.finish({ type: 'done', responseId: 'resp_3' })
    await asked

    const kinds = chatOf(tabId).items.map((item) => item.kind)
    expect(kinds).toEqual(['user', 'assistant', 'divider', 'user', 'assistant'])
    expect(lastAnswer().error).toBeUndefined()
    expect(chatOf(tabId).conversation?.responseId).toBe('resp_3')
  })

  it('treats a stream that ended without a word in a continued conversation the same way', async () => {
    void askAssistant(tabId, { action: 'define', selection: 'a', page: 0 })
    ;(await nthCall(1)).finish({ type: 'done', responseId: 'resp_1' })
    await vi.waitFor(() => expect(chatOf(tabId).streaming).toBe(false))

    const asked = askAssistant(tabId, { action: 'ask', question: 'More?' })
    ;(await nthCall(2)).finish({
      type: 'error',
      error: { code: 'stream_ended', message: 'Ended.' }
    })
    const fresh = await nthCall(3)
    // Only once: a second failure is shown.
    fresh.finish({ type: 'error', error: { code: 'stream_ended', message: 'Ended again.' } })
    await asked
    expect(calls).toHaveLength(3)
    expect(lastAnswer().error?.message).toBe('Ended again.')
  })

  it('shows an error, and Retry asks the same question again', async () => {
    const asked = askAssistant(tabId, { action: 'simplify', selection: 'x', page: 0 })
    ;(await nthCall(1)).finish({
      type: 'error',
      error: { code: 'out_of_memory', message: 'Not enough memory.' }
    })
    await asked
    expect(lastAnswer()).toMatchObject({ streaming: false, error: { code: 'out_of_memory' } })
    expect(chatOf(tabId).conversation).toBeNull()

    retryAssistant(tabId)
    const again = await nthCall(2)
    expect(again.request.input).toBe('Simplify x')
    expect(chatOf(tabId).items.map((item) => item.kind)).toEqual(['user', 'assistant'])
    expect(lastAnswer().error).toBeUndefined()
  })

  it('stops an answer and keeps what arrived', async () => {
    const asked = askAssistant(tabId, { action: 'simplify', selection: 'x', page: 0 })
    const call = await nthCall(1)
    call.emit({ type: 'delta', text: 'Partial' })
    stopAssistant(tabId)
    expect(ai.cancel).toHaveBeenCalledWith(call.request.requestId)
    await asked
    expect(lastAnswer()).toMatchObject({ text: 'Partial', cancelled: true, streaming: false })
    expect(chatOf(tabId).streaming).toBe(false)
    expect(chatOf(tabId).conversation).toBeNull()
  })

  it('cancels the running answer when a new question is asked', async () => {
    const first = askAssistant(tabId, { action: 'simplify', selection: 'x', page: 0 })
    const call = await nthCall(1)
    const second = askAssistant(tabId, { action: 'define', selection: 'y', page: 0 })
    expect(ai.cancel).toHaveBeenCalledWith(call.request.requestId)
    await first
    const next = await nthCall(2)
    expect(next.request.input).toBe('Define y')
    expect(chatOf(tabId).streaming).toBe(true)
    next.finish({ type: 'done', responseId: 'resp_2' })
    await second
    const [stopped, answered] = answers()
    expect(stopped.cancelled).toBe(true)
    expect(answered.cancelled).toBeUndefined()
  })

  it('sends the whole document within the budget and sizes the context to fit', async () => {
    useTabs.getState().patchTab(tabId, { pageCount: 40 })
    engineMock.plainText.mockImplementation(async () => ({
      pages: [
        { index: 0, text: 'a'.repeat(20000) },
        { index: 1, text: 'b'.repeat(20000) }
      ],
      pageCount: 40,
      truncated: true
    }))
    setContextMode(tabId, 'document')
    void askAssistant(tabId, { action: 'ask', question: 'Summarise' })
    const call = await nthCall(1)

    const options = engineMock.plainText.mock.calls[0][1] as {
      from: number
      to: number
      maxChars: number
    }
    expect(options).toMatchObject({ from: 0, to: 39 })
    // 32,768 tokens (the setting) less the prompt and the answer reserve, as characters.
    expect(options.maxChars).toBeGreaterThan(90_000)
    expect(options.maxChars).toBeLessThan(32768 * 3.5)
    // 40,000 characters do not fit the loaded 8K: a larger size is asked for.
    expect(call.request.contextLength).toBe(16384)
    expect(call.request.systemPrompt).toContain('pages 1–2 of 40')
    expect(chatOf(tabId).contextNote).toBe('Pages 1–2 of 40 included')
  })

  it('waits for LM Studio when it is not running, and saves a replacement for a missing model', async () => {
    ai.listModels.mockImplementationOnce(async () => ({
      reachable: false,
      url: 'http://127.0.0.1:1234',
      error: { code: 'unreachable', message: 'Not running.' },
      models: []
    }))
    await askAssistant(tabId, { action: 'simplify', selection: 'x', page: 0 })
    expect(calls).toHaveLength(0)
    expect(chatOf(tabId).blocked).toMatchObject({ action: 'simplify' })
    expect(chatOf(tabId).items).toHaveLength(0)
    expect(useAssistant.getState().server?.reachable).toBe(false)

    await setModel('removed/model')
    void askAssistant(tabId, { action: 'simplify', selection: 'x', page: 0 })
    expect((await nthCall(1)).request.model).toBe('google/gemma-4')
    await vi.waitFor(() => expect(settings.aiModel).toBe('google/gemma-4'))
    expect(chatOf(tabId).blocked).toBeNull()
  })

  it('clears the chat, and drops it when the tab closes', async () => {
    void askAssistant(tabId, { action: 'simplify', selection: 'x', page: 0 })
    ;(await nthCall(1)).finish({ type: 'done', responseId: 'resp_1' })
    await vi.waitFor(() => expect(chatOf(tabId).streaming).toBe(false))
    clearAssistant(tabId)
    expect(chatOf(tabId)).toMatchObject({ items: [], conversation: null })

    void askAssistant(tabId, { action: 'simplify', selection: 'y', page: 0 })
    const call = await nthCall(2)
    forgetAssistant(tabId)
    useTabs.getState().removeTab(tabId)
    expect(ai.cancel).toHaveBeenCalledWith(call.request.requestId)
    expect(useAssistant.getState().tabs[tabId]).toBeUndefined()
  })
})
