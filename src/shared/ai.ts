/**
 * The AI assistant's shared types and context-budget helpers, used by main
 * (the LM Studio client) and the renderer (the assistant panel). Pure: no
 * Electron, Node or DOM imports.
 *
 * LM Studio facts these rely on are in docs/plan/STATUS.md ("Verified facts").
 */

/** A chat model LM Studio offers. */
export interface AiModel {
  /** What `/api/v1/chat` takes as `model`, e.g. `google/gemma-4-26b-a4b`. */
  key: string
  /** For people, e.g. "Gemma 4 26B A4B". */
  label: string
  /** The most context the model supports, in tokens. */
  maxContext?: number
  /**
   * The context of the largest loaded instance, in tokens; undefined when the
   * model is not loaded.
   */
  loadedContext?: number
  /** Every loaded instance's context, largest first (several copies can be loaded). */
  loadedContexts: number[]
  /** The `reasoning` values the model accepts (e.g. `['off', 'on']`); absent if none. */
  reasoningOptions?: string[]
  /** What the model does when `reasoning` is not sent. */
  reasoningDefault?: string
}

/** What `ai.listModels()` returns. */
export interface AiServerInfo {
  /** LM Studio answered. */
  reachable: boolean
  /** The server address from the settings. */
  url: string
  error?: AiError
  /** Chat models only (no embedding models). */
  models: AiModel[]
  /**
   * Set with an `unreachable` error: PDFnix can start the server itself
   * (`ai.startServer`), because LM Studio's `lms` tool is installed and the
   * address is on this computer.
   */
  canStartServer?: boolean
}

/** What `ai.startServer()` returns. */
export type AiStartResult = { ok: true } | { ok: false; message: string }

/**
 * - `unreachable`: nothing answers at the address (server not started)
 * - `outdated`: the server has no `/api/v1` (LM Studio older than 0.4)
 * - `model_not_found`: the model is not downloaded in LM Studio
 * - `out_of_memory`: LM Studio refused to load the model at that context
 * - `conversation_expired`: `previousResponseId` is no longer stored; start a new conversation
 * - `stream_ended`: the answer stopped without a reason (usually: the text is longer than the context)
 * - `timeout`: LM Studio stopped sending anything
 * - `server_error`: anything else; `message` is the server's own, cut to 300 characters
 */
export type AiErrorCode =
  | 'unreachable'
  | 'outdated'
  | 'model_not_found'
  | 'out_of_memory'
  | 'conversation_expired'
  | 'stream_ended'
  | 'timeout'
  | 'server_error'

export interface AiError {
  code: AiErrorCode
  /** A sentence to show the user. */
  message: string
}

export interface AiStats {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  tokensPerSecond?: number
  timeToFirstTokenSeconds?: number
  modelLoadSeconds?: number
}

/**
 * What a chat stream reports. A request ends with exactly one terminal event:
 * `done` (possibly with `cancelled: true`) or `error`.
 */
export type AiEvent =
  /** LM Studio is loading the model (`loading`) or reading the prompt (`reading`); progress 0…1. */
  | { type: 'status'; stage: 'loading' | 'reading'; progress: number }
  /** A piece of the model's reasoning ("thinking"). */
  | { type: 'thinking'; text: string }
  /** A piece of the answer. */
  | { type: 'delta'; text: string }
  | { type: 'done'; responseId?: string; stats?: AiStats; cancelled?: boolean }
  | { type: 'error'; error: AiError }

/** An `AiEvent` as main sends it to the renderer (`ai:event`). */
export type AiEventMessage = AiEvent & { requestId: string }

export const AI_REASONING_VALUES = ['off', 'on', 'low', 'medium', 'high'] as const
export type AiReasoning = (typeof AI_REASONING_VALUES)[number]

export interface AiChatRequest {
  /** Chosen by the renderer; names the request in events and `cancel`. */
  requestId: string
  model: string
  /** The user's message. */
  input: string
  /** Only when starting a conversation: a continued one keeps the first turn's. */
  systemPrompt?: string
  /** Continues the conversation that answer ended. */
  previousResponseId?: string
  /**
   * The context size to run at, in tokens. LM Studio answers with a loaded
   * instance of exactly this size, or loads one (unloading the model's smaller
   * instances first). Use `chooseContextLength`.
   */
  contextLength?: number
  /** Only values in the model's `reasoningOptions`. Omit for the model's default. */
  reasoning?: AiReasoning
}

/** Limits main enforces on `ai:chat` requests. */
export const AI_LIMITS = {
  requestId: 100,
  model: 200,
  /** `input` and `systemPrompt` together, in characters. */
  text: 2_000_000,
  contextLength: { min: 2048, max: 262_144 }
} as const

export const RESPONSE_ID = /^resp_[A-Za-z0-9_-]{1,200}$/

/** Characters per token, roughly, for prose in Latin script. */
export const CHARS_PER_TOKEN = 3.5

/** Tokens kept free for the answer. */
export const ANSWER_RESERVE = 1024

/** Context sizes are asked for in steps of this many tokens. */
export const CONTEXT_STEP = 4096

/** The "Largest context" choices in Settings, in tokens. */
export const AI_MAX_CONTEXT_CHOICES = [4096, 8192, 16384, 32768, 65536, 131072] as const
export const AI_MAX_CONTEXT = { min: 4096, max: 131_072, default: 32_768 } as const

export const DEFAULT_AI_SERVER_URL = 'http://127.0.0.1:1234'

/**
 * An LM Studio server address: an http or https URL without credentials,
 * query or fragment, trailing slashes removed. Null if it is not one.
 */
export function normalizeServerUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password || url.search || url.hash) return null
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

export type AiContextMode = 'page' | 'document'

export function isAiContextMode(value: unknown): value is AiContextMode {
  return value === 'page' || value === 'document'
}

/** A rough token count: a little generous, so the context is not overrun. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * The context size to ask LM Studio for.
 *
 * When the model is loaded with enough room, that instance's size is
 * returned, so LM Studio answers with it and nothing is reloaded (sending a
 * size always, rather than none, makes LM Studio pick that instance when
 * several copies are loaded). Otherwise: `neededTokens` rounded up to a
 * multiple of 4,096, at least 4,096, at most the model's maximum and `cap`.
 */
export function chooseContextLength(options: {
  neededTokens: number
  loadedContext?: number
  maxContext?: number
  cap: number
}): number {
  const { neededTokens, loadedContext, maxContext, cap } = options
  if (loadedContext !== undefined && loadedContext >= neededTokens) return loadedContext
  const ceiling = Math.max(CONTEXT_STEP, Math.min(maxContext ?? cap, cap))
  const wanted = Math.max(CONTEXT_STEP, Math.ceil(neededTokens / CONTEXT_STEP) * CONTEXT_STEP)
  return Math.min(wanted, ceiling)
}

/**
 * How many characters of document text fit in a context of `contextTokens`
 * beside `otherTokens` (system prompt and question) and the answer reserve.
 */
export function excerptCharBudget(options: { contextTokens: number; otherTokens: number }): number {
  const free = options.contextTokens - options.otherTokens - ANSWER_RESERVE
  return Math.max(0, Math.floor(free * CHARS_PER_TOKEN))
}
