/**
 * The AI assistant: one chat per tab, answered by the user's LM Studio
 * through main (`window.api.ai`). Kept in memory only; a tab's chat is dropped
 * when the tab closes (`forgetAssistant`, called from `documents.ts`).
 *
 * A conversation lives on the LM Studio server: the first question sends the
 * system prompt with the document's text, follow-ups send only the question
 * and the previous answer's id. The rules for what is sent are in
 * `assistantRules.ts`; LM Studio's behaviour is in STATUS.md, "Verified facts".
 */

import { create } from 'zustand'
import {
  AI_LIMITS,
  ANSWER_RESERVE,
  chooseContextLength,
  estimateTokens,
  excerptCharBudget,
  type AiChatRequest,
  type AiContextMode,
  type AiError,
  type AiEvent,
  type AiEventMessage,
  type AiModel,
  type AiServerInfo,
  type AiStats
} from '../../../shared/ai'
import { engine, type PlainText } from '@/api/engine'
import {
  canContinue,
  contextNote,
  dividerLabel,
  excerptText,
  pagesLabel,
  promptOverhead,
  reasoningFor,
  resolveModel,
  systemPrompt,
  userPrompt,
  type AssistantAction,
  type AssistantAsk,
  type Conversation
} from './assistantRules'
import { clearCitation, locateQuotes } from './citation'
import { citationQuotes } from './citationRules'
import { useSettings } from './settings'
import { getTab, type DocumentTab } from './tabs'

export type { AssistantAction, AssistantAsk, Conversation } from './assistantRules'

export interface UserItem {
  kind: 'user'
  id: string
  action: AssistantAction
  question?: string
  selection?: string
  /** The page the question is about (0-based). */
  page: number
}

export interface AnswerItem {
  kind: 'assistant'
  id: string
  /** The answer so far (Markdown). */
  text: string
  /** The model is reasoning before it answers (its reasoning is not shown). */
  thinking: boolean
  /** LM Studio is loading the model or reading the prompt; progress 0…1. */
  status?: { stage: 'loading' | 'reading'; progress: number }
  error?: AiError
  cancelled?: boolean
  /** Still arriving. */
  streaming: boolean
  /** The model that answers, for the progress line ("Loading Gemma 4…"). */
  modelLabel: string
  /** LM Studio's figures for a finished answer (speed, time to first token, tokens). */
  stats?: AiStats
  /** Where each quoted citation's words are in the document (0-based page, null: not found). */
  quotePages?: Record<string, number | null>
}

export interface DividerItem {
  kind: 'divider'
  id: string
  label: string
}

export type ChatItem = UserItem | AnswerItem | DividerItem

export interface TabAssistant {
  items: ChatItem[]
  /** The server-side thread follow-up questions continue. */
  conversation: Conversation | null
  streaming: boolean
  /** The request being answered. */
  requestId: string | null
  contextMode: AiContextMode
  /** What the model was given, when that is worth saying ("Pages 1–12 of 40 included"). */
  contextNote: string | null
  /** A selection waiting in the input as a quote (Ask AI Assistant). */
  pendingQuote: { text: string; page: number } | null
  /** A question that could not be sent because LM Studio was not available. */
  blocked: AssistantAsk | null
  /** How much of the context the conversation fills, after its last answer. */
  usage: ContextUsage | null
}

/** Tokens the conversation holds (prompt, history and answers) out of its context size. */
export interface ContextUsage {
  used: number
  total: number
}

interface AssistantState {
  tabs: Record<string, TabAssistant>
  /** The last `ai.listModels` answer; null until asked. */
  server: AiServerInfo | null
  loadingModels: boolean
}

export const useAssistant = create<AssistantState>(() => ({
  tabs: {},
  server: null,
  loadingModels: false
}))

/** The panel's input listens for this to take the focus. */
export const FOCUS_ASSISTANT_EVENT = 'pdfnix:focus-assistant'

/** A focus request the input has not seen yet (it may not be mounted). */
let focusWanted = false

/** Puts the cursor in the panel's input, now or as soon as the panel is there. */
export function focusAssistantInput(): void {
  focusWanted = true
  window.dispatchEvent(new Event(FOCUS_ASSISTANT_EVENT))
}

/** Whether the input should take the focus; true once per request. */
export function takeFocusRequest(): boolean {
  const wanted = focusWanted
  focusWanted = false
  return wanted
}

function emptyChat(): TabAssistant {
  return {
    items: [],
    conversation: null,
    streaming: false,
    requestId: null,
    contextMode: useSettings.getState().aiContext,
    contextNote: null,
    pendingQuote: null,
    blocked: null,
    usage: null
  }
}

/** A tab's chat; a fresh one (not stored) if it has none yet. */
export function chatOf(tabId: string): TabAssistant {
  return useAssistant.getState().tabs[tabId] ?? emptyChat()
}

function patchChat(
  tabId: string,
  change: Partial<TabAssistant> | ((chat: TabAssistant) => Partial<TabAssistant>)
): void {
  useAssistant.setState((state) => {
    // A request finishing after its tab closed must not bring the chat back.
    if (!(tabId in state.tabs) && !getTab(tabId)) return state
    const chat = state.tabs[tabId] ?? emptyChat()
    const patch = typeof change === 'function' ? change(chat) : change
    return { tabs: { ...state.tabs, [tabId]: { ...chat, ...patch } } }
  })
}

function patchAnswer(
  tabId: string,
  itemId: string,
  change: (item: AnswerItem) => AnswerItem
): void {
  const chat = useAssistant.getState().tabs[tabId]
  if (!chat) return
  const index = chat.items.findIndex((item) => item.id === itemId)
  const item = chat.items[index]
  if (!item || item.kind !== 'assistant') return
  const items = chat.items.slice()
  items[index] = change(item)
  patchChat(tabId, { items })
}

let nextId = 1
const newId = (prefix: string): string => `${prefix}-${nextId++}`

let nextRequest = 1
function newRequestId(): string {
  return `ai-${Date.now().toString(36)}-${nextRequest++}`
}

// --- events from main ----------------------------------------------------------

/** Requests being answered: where their events go. */
const running = new Map<string, { tabId: string; itemId: string }>()
/** Requests stopped before main had them (while the document's text was read). */
const stopped = new Set<string>()
let unsubscribe: (() => void) | null = null

function onEvent(event: AiEventMessage): void {
  const target = running.get(event.requestId)
  if (!target) return
  switch (event.type) {
    case 'status':
      patchAnswer(target.tabId, target.itemId, (item) => ({
        ...item,
        status: { stage: event.stage, progress: event.progress }
      }))
      break
    case 'thinking':
      patchAnswer(target.tabId, target.itemId, (item) =>
        item.thinking && item.status === undefined
          ? item
          : { ...item, thinking: true, status: undefined }
      )
      break
    case 'delta':
      patchAnswer(target.tabId, target.itemId, (item) => ({
        ...item,
        text: item.text + event.text,
        thinking: false,
        status: undefined
      }))
      break
    // `done` and `error` come back as the result of `ai.chat` as well; they
    // are handled there.
  }
}

function listen(): void {
  unsubscribe ??= window.api.ai.onEvent(onEvent)
}

/** Stops listening (tests). */
export function resetAssistant(): void {
  unsubscribe?.()
  unsubscribe = null
  running.clear()
  stopped.clear()
  generations.clear()
  refreshing = null
  useAssistant.setState({ tabs: {}, server: null, loadingModels: false })
}

// --- models ----------------------------------------------------------------------

let refreshing: Promise<AiServerInfo> | null = null

/** Asks LM Studio for its models (once at a time) and keeps the answer in `server`. */
export function refreshModels(): Promise<AiServerInfo> {
  if (refreshing) return refreshing
  useAssistant.setState({ loadingModels: true })
  const request = window.api.ai
    .listModels()
    .catch((error: unknown): AiServerInfo => ({
      reachable: false,
      url: '',
      error: { code: 'server_error', message: errorText(error) },
      models: []
    }))
    .then((server) => {
      useAssistant.setState({ server, loadingModels: false })
      return server
    })
    .finally(() => {
      if (refreshing === request) refreshing = null
    })
  refreshing = request
  return request
}

/** The model the next question goes to, from the last known model list. */
export function currentModel(
  server: AiServerInfo | null = useAssistant.getState().server
): AiModel | null {
  return resolveModel(server?.models ?? [], useSettings.getState().aiModel)?.model ?? null
}

/** Chooses the model (null: automatic). The next question in every tab starts a new conversation. */
export async function setModel(key: string | null): Promise<void> {
  await useSettings.getState().update({ aiModel: key })
}

// --- asking ----------------------------------------------------------------------

/** Per tab, which `askAssistant` call is the latest; older ones stop touching the chat. */
const generations = new Map<string, number>()

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cancelledEvent(): AiEvent {
  return { type: 'done', cancelled: true }
}

interface Context {
  systemPrompt: string
  contextLength: number
  note: string | null
}

/** The text the model is given with a new conversation: this page or the whole document. */
async function buildContext(options: {
  tab: DocumentTab
  mode: AiContextMode
  page: number
  input: string
  model: AiModel
  cap: number
}): Promise<Context> {
  const { tab, mode, page, input, model, cap } = options
  const contextTokens = Math.min(model.maxContext ?? cap, cap)
  const from = mode === 'page' ? page : 0
  const to = mode === 'page' ? page : tab.pageCount - 1
  const otherTokens = promptOverhead(tab.fileName, input, to - from + 1)
  const maxChars = Math.min(
    AI_LIMITS.text - input.length,
    Math.max(1, excerptCharBudget({ contextTokens, otherTokens }))
  )
  const plain: PlainText = await engine.plainText(tab.docId, { from, to, maxChars })
  const label = pagesLabel({
    mode,
    pages: plain.pages.map((item) => item.index),
    pageCount: plain.pageCount
  })
  const system = systemPrompt(excerptText(plain.pages), tab.fileName, label, plain.truncated)
  const contextLength = Math.max(
    AI_LIMITS.contextLength.min,
    chooseContextLength({
      neededTokens: estimateTokens(system + input) + ANSWER_RESERVE,
      loadedContext: model.loadedContext,
      maxContext: model.maxContext,
      cap
    })
  )
  const note = contextNote({
    mode,
    pages: plain.pages,
    pageCount: plain.pageCount,
    truncated: plain.truncated
  })
  return { systemPrompt: system, contextLength, note }
}

interface Turn {
  tabId: string
  input: string
  model: AiModel
  contextMode: AiContextMode
  page: number
  revision: number
  answerId: string
  userId: string
}

/** Sends one request for `turn` and waits for its terminal event. */
async function send(turn: Turn, continuing: Conversation | null): Promise<AiEvent> {
  const { tabId } = turn
  const requestId = newRequestId()
  patchChat(tabId, { streaming: true, requestId })
  running.set(requestId, { tabId, itemId: turn.answerId })
  try {
    const reasoning = reasoningFor(turn.model)
    let request: AiChatRequest
    if (continuing) {
      request = {
        requestId,
        model: turn.model.key,
        input: turn.input,
        previousResponseId: continuing.responseId,
        contextLength: continuing.contextLength,
        ...(reasoning && { reasoning })
      }
    } else {
      const tab = getTab(tabId)
      if (!tab) return cancelledEvent()
      let context: Context
      try {
        context = await buildContext({
          tab,
          mode: turn.contextMode,
          page: turn.page,
          input: turn.input,
          model: turn.model,
          cap: useSettings.getState().aiMaxContext
        })
      } catch (error) {
        return {
          type: 'error',
          error: {
            code: 'server_error',
            message: `Could not read the document's text: ${errorText(error)}`
          }
        }
      }
      if (stopped.has(requestId)) return cancelledEvent()
      patchChat(tabId, { contextNote: context.note })
      request = {
        requestId,
        model: turn.model.key,
        input: turn.input,
        systemPrompt: context.systemPrompt,
        contextLength: context.contextLength,
        ...(reasoning && { reasoning })
      }
    }

    let result: AiEvent
    try {
      result = await window.api.ai.chat(request)
    } catch (error) {
      result = { type: 'error', error: { code: 'server_error', message: errorText(error) } }
    }
    if (result.type === 'done' && !result.cancelled && result.responseId) {
      const contextLength = request.contextLength ?? continuing?.contextLength ?? 0
      // A continued turn's input counts the whole conversation so far
      // (checked against LM Studio 0.4.16), so its input and output are what
      // the context holds now.
      const used = (result.stats?.inputTokens ?? 0) + (result.stats?.outputTokens ?? 0)
      patchChat(tabId, {
        usage: used > 0 && contextLength > 0 ? { used, total: contextLength } : null,
        conversation: {
          responseId: result.responseId,
          model: turn.model.key,
          contextMode: turn.contextMode,
          page: turn.page,
          contextLength,
          revision: continuing?.revision ?? turn.revision
        }
      })
    }
    return result
  } finally {
    running.delete(requestId)
    stopped.delete(requestId)
    patchChat(tabId, (chat) =>
      chat.requestId === requestId ? { streaming: false, requestId: null } : {}
    )
  }
}

/** Errors after which a continued conversation is started afresh. */
function conversationLost(result: AiEvent): boolean {
  return (
    result.type === 'error' &&
    (result.error.code === 'conversation_expired' || result.error.code === 'stream_ended')
  )
}

/**
 * Asks the assistant: Simplify, Define or a question, about the selection,
 * the page or the document. Cancels an answer still running in the tab.
 */
export async function askAssistant(tabId: string, ask: AssistantAsk): Promise<void> {
  if (!getTab(tabId)) return
  const input = userPrompt(ask)
  if (input.trim() === '') return
  listen()
  const generation = (generations.get(tabId) ?? 0) + 1
  generations.set(tabId, generation)
  const latest = (): boolean => generations.get(tabId) === generation && getTab(tabId) !== null
  stopAssistant(tabId)
  if (ask.action === 'ask') patchChat(tabId, { pendingQuote: null })

  const server = await refreshModels()
  if (!latest()) return
  const resolved = resolveModel(server.models, useSettings.getState().aiModel)
  if (!server.reachable || server.error || !resolved) {
    // The panel shows why; its Retry sends the question once LM Studio is there.
    patchChat(tabId, { blocked: ask })
    return
  }
  if (resolved.stale) {
    void useSettings
      .getState()
      .update({ aiModel: resolved.model.key })
      .catch(() => {})
  }

  const tab = getTab(tabId)!
  const chat = chatOf(tabId)
  const page = Math.min(Math.max(ask.page ?? tab.page, 0), Math.max(tab.pageCount - 1, 0))
  const model = resolved.model
  const turn: Turn = {
    tabId,
    input,
    model,
    contextMode: chat.contextMode,
    page,
    revision: tab.revision,
    answerId: newId('answer'),
    userId: newId('user')
  }
  const continuing = canContinue(chat.conversation, {
    model: model.key,
    contextMode: chat.contextMode,
    page,
    revision: tab.revision
  })
    ? chat.conversation
    : null

  const user: UserItem = {
    kind: 'user',
    id: turn.userId,
    action: ask.action,
    page,
    ...(ask.question !== undefined && { question: ask.question.trim() }),
    ...(ask.selection?.trim() && { selection: ask.selection.trim() })
  }
  const answer: AnswerItem = {
    kind: 'assistant',
    id: turn.answerId,
    text: '',
    thinking: false,
    streaming: true,
    modelLabel: model.label
  }
  const divider = (): DividerItem => ({
    kind: 'divider',
    id: newId('divider'),
    label: dividerLabel(turn.contextMode, page, model.label)
  })
  patchChat(tabId, (current) => ({
    items: [
      ...current.items,
      ...(continuing || current.items.length === 0 ? [] : [divider()]),
      user,
      answer
    ],
    blocked: null,
    ...(!continuing && { conversation: null, contextNote: null, usage: null })
  }))

  let result = await send(turn, continuing)
  if (continuing && conversationLost(result) && latest()) {
    // The stored conversation is gone (or has outgrown the context): start
    // again with the document's text.
    patchChat(tabId, (current) => {
      const items = current.items.slice()
      const at = items.findIndex((item) => item.id === turn.userId)
      if (at !== -1) items.splice(at, 0, divider())
      return { items, conversation: null, usage: null }
    })
    patchAnswer(tabId, turn.answerId, (item) => ({ ...item, text: '', thinking: false }))
    result = await send(turn, null)
  }
  patchAnswer(tabId, turn.answerId, (item) => ({
    ...item,
    streaming: false,
    thinking: false,
    status: undefined,
    ...(result.type === 'error' && { error: result.error }),
    ...(result.type === 'done' && result.cancelled && { cancelled: true }),
    ...(result.type === 'done' && !result.cancelled && result.stats && { stats: result.stats })
  }))
  if (result.type === 'done' && !result.cancelled) void placeQuotes(tabId, turn.answerId)
}

/**
 * Looks up the finished answer's quotes in the document, so each citation
 * chip points at the page the words are really on.
 */
async function placeQuotes(tabId: string, answerId: string): Promise<void> {
  const tab = getTab(tabId)
  const item = chatOf(tabId).items.find((entry) => entry.id === answerId)
  if (!tab || item?.kind !== 'assistant') return
  const quotes = citationQuotes(item.text)
  if (quotes.length === 0) return
  const quotePages = await locateQuotes(tab.docId, quotes)
  // The document may have changed (or closed) meanwhile; then the pages may be wrong.
  if (getTab(tabId)?.revision !== tab.revision) return
  patchAnswer(tabId, answerId, (answer) => ({ ...answer, quotePages }))
}

/** Stops the answer running in the tab, if any; it is kept as far as it got. */
export function stopAssistant(tabId: string): void {
  const requestId = useAssistant.getState().tabs[tabId]?.requestId
  if (!requestId) return
  stopped.add(requestId)
  window.api.ai.cancel(requestId)
}

/** Asks the last question again (after an error). */
export function retryAssistant(tabId: string): void {
  const chat = useAssistant.getState().tabs[tabId]
  if (!chat) return
  let at = -1
  for (let index = chat.items.length - 1; index >= 0; index--) {
    if (chat.items[index].kind === 'user') {
      at = index
      break
    }
  }
  if (at === -1) return
  const user = chat.items[at] as UserItem
  // The question goes again, with a divider of its own if it needs one.
  const start = at > 0 && chat.items[at - 1].kind === 'divider' ? at - 1 : at
  patchChat(tabId, { items: chat.items.slice(0, start) })
  void askAssistant(tabId, {
    action: user.action,
    page: user.page,
    ...(user.question !== undefined && { question: user.question }),
    ...(user.selection !== undefined && { selection: user.selection })
  })
}

/** Checks LM Studio again and sends the question that was waiting for it. */
export async function retryBlocked(tabId: string): Promise<void> {
  const server = await refreshModels()
  const blocked = useAssistant.getState().tabs[tabId]?.blocked
  if (!blocked || !server.reachable || server.error || server.models.length === 0) return
  await askAssistant(tabId, blocked)
}

/** Empties the chat and forgets the conversation. */
export function clearAssistant(tabId: string): void {
  stopAssistant(tabId)
  clearCitation(tabId)
  patchChat(tabId, {
    items: [],
    conversation: null,
    contextNote: null,
    blocked: null,
    usage: null
  })
}

/** This page or the whole document; also the default for new tabs. Starts a new conversation. */
export function setContextMode(tabId: string, mode: AiContextMode): void {
  patchChat(tabId, { contextMode: mode })
  void useSettings
    .getState()
    .update({ aiContext: mode })
    .catch(() => {})
}

/** Puts a selection in the input as a quote, for a question about it. */
export function setPendingQuote(tabId: string, quote: { text: string; page: number } | null): void {
  patchChat(tabId, { pendingQuote: quote })
}

/** Drops a closed tab's chat, stopping its answer. */
export function forgetAssistant(tabId: string): void {
  stopAssistant(tabId)
  clearCitation(tabId)
  generations.delete(tabId)
  useAssistant.setState((state) => {
    if (!(tabId in state.tabs)) return state
    const tabs = { ...state.tabs }
    delete tabs[tabId]
    return { tabs }
  })
}
