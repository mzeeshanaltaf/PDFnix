/**
 * LM Studio's native REST API (`/api/v1`), the pure parts: server-sent events,
 * mapping LM Studio's events and errors to the app's, the model list and
 * validation of requests from the renderer. Tested in ai-protocol.test.ts with
 * payloads recorded from LM Studio 0.4.16 (see STATUS.md, "Verified facts").
 */

import {
  AI_LIMITS,
  AI_REASONING_VALUES,
  RESPONSE_ID,
  type AiChatRequest,
  type AiError,
  type AiEvent,
  type AiModel,
  type AiReasoning,
  type AiStats
} from '../shared/ai'

export interface SseEvent {
  event: string
  data: string
}

/**
 * Splits a server-sent event stream into events. `buffer` is the `rest` of the
 * previous call; `chunk` the newly decoded text. A line or event may be split
 * anywhere; what is not complete yet comes back as `rest`.
 */
export function parseSse(buffer: string, chunk: string): { events: SseEvent[]; rest: string } {
  let text = buffer + chunk
  // A CR at the very end may be the first half of a CRLF: keep it for later.
  let held = ''
  if (text.endsWith('\r')) {
    held = '\r'
    text = text.slice(0, -1)
  }
  const blocks = text.replace(/\r\n?/g, '\n').split('\n\n')
  const rest = (blocks.pop() ?? '') + held
  const events: SseEvent[] = []
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function progressOf(data: Record<string, unknown>): number {
  return Math.min(1, Math.max(0, num(data.progress) ?? 0))
}

function statsOf(value: unknown): AiStats | undefined {
  const stats = record(value)
  if (!stats) return undefined
  return {
    inputTokens: num(stats.input_tokens),
    outputTokens: num(stats.total_output_tokens),
    reasoningTokens: num(stats.reasoning_output_tokens),
    tokensPerSecond: num(stats.tokens_per_second),
    timeToFirstTokenSeconds: num(stats.time_to_first_token_seconds),
    modelLoadSeconds: num(stats.model_load_time_seconds)
  }
}

/**
 * The app's event for one of LM Studio's, or null for events the app does not
 * use (`chat.start`, `*.end`, `message.start`, tool calls…).
 */
export function toAiEvent(sse: SseEvent, model?: string): AiEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(sse.data)
  } catch {
    return null
  }
  const data = record(parsed)
  if (!data) return null
  switch (sse.event) {
    case 'model_load.start':
      return { type: 'status', stage: 'loading', progress: 0 }
    case 'model_load.progress':
      return { type: 'status', stage: 'loading', progress: progressOf(data) }
    case 'prompt_processing.start':
      return { type: 'status', stage: 'reading', progress: 0 }
    case 'prompt_processing.progress':
      return { type: 'status', stage: 'reading', progress: progressOf(data) }
    case 'reasoning.delta': {
      const text = str(data.content)
      return text ? { type: 'thinking', text } : null
    }
    case 'message.delta': {
      const text = str(data.content)
      return text ? { type: 'delta', text } : null
    }
    case 'error':
      return { type: 'error', error: friendlyError({ body: data, model }) }
    case 'chat.end': {
      const result = record(data.result)
      return {
        type: 'done',
        responseId: str(result?.response_id),
        stats: statsOf(result?.stats)
      }
    }
    default:
      return null
  }
}

export const MESSAGES = {
  unreachable:
    "LM Studio's server isn't running. Start it in LM Studio (Developer → Start server) or run “lms server start”.",
  outdated: 'Update LM Studio to version 0.4 or newer.',
  conversationExpired: 'LM Studio no longer has the earlier conversation. Start a new one.',
  streamEnded:
    "LM Studio stopped without finishing the answer. The text sent may be longer than the model's context: start a new conversation, or raise 'Largest context' in Settings.",
  timeout: 'LM Studio stopped responding.'
} as const

const MAX_MESSAGE = 300

function modelNotFound(model: string | undefined): string {
  return model
    ? `The model “${model}” isn't available in LM Studio.`
    : "The model isn't available in LM Studio."
}

function outOfMemory(model: string | undefined): string {
  return `Not enough memory to load ${model ? `“${model}”` : 'the model'} at this context size. Lower 'Largest context' in Settings or choose a smaller model.`
}

/** A failure to connect at all (as opposed to an HTTP error). */
function isConnectionFailure(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  if (cause.name === 'TimeoutError') return true
  if (cause.name === 'TypeError' && /fetch failed/i.test(cause.message)) return true
  const code = str(record((cause as { cause?: unknown }).cause)?.code)
  return (
    code !== undefined &&
    /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|UND_ERR_)/.test(code)
  )
}

/**
 * The message to show for a failed request: a connection failure (`cause`),
 * an HTTP error (`status`, `body` as JSON or text) or an `error` event
 * (`body` is its data).
 */
export function friendlyError(input: {
  cause?: unknown
  status?: number
  body?: unknown
  model?: string
}): AiError {
  const { cause, status, body, model } = input
  if (cause !== undefined && status === undefined && body === undefined) {
    if (isConnectionFailure(cause)) return { code: 'unreachable', message: MESSAGES.unreachable }
    const text = cause instanceof Error ? cause.message : String(cause)
    return { code: 'server_error', message: text.slice(0, MAX_MESSAGE) }
  }

  const outer = record(body)
  const inner = record(outer?.error)
  // `{"error": "Unexpected endpoint or method. (GET /api/v1/models)"}`: no such route.
  const plain = str(outer?.error) ?? (typeof body === 'string' ? body : undefined)
  const message = str(inner?.message) ?? plain ?? ''
  const code = str(inner?.code)
  const type = str(inner?.type)
  const param = str(inner?.param)

  if (status === 404 && !inner) return { code: 'outdated', message: MESSAGES.outdated }
  if (code === 'model_not_found' || type === 'model_not_found') {
    return { code: 'model_not_found', message: modelNotFound(model) }
  }
  if (
    /insufficient system resources|out of memory|not enough memory|failed to allocate/i.test(
      message
    )
  ) {
    return { code: 'out_of_memory', message: outOfMemory(model) }
  }
  if (param === 'previous_response_id' || /previous_response_id/.test(message)) {
    return { code: 'conversation_expired', message: MESSAGES.conversationExpired }
  }
  const shown =
    message.trim() ||
    (status ? `LM Studio answered with HTTP ${status}.` : 'LM Studio reported an error.')
  return { code: 'server_error', message: shown.slice(0, MAX_MESSAGE) }
}

function contextsOf(instances: unknown): number[] {
  if (!Array.isArray(instances)) return []
  return instances
    .map((instance) => num(record(record(instance)?.config)?.context_length))
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => b - a)
}

/** Chat models from `GET /api/v1/models` (embedding models are left out). */
export function filterModels(raw: unknown): AiModel[] {
  const list = record(raw)?.models
  if (!Array.isArray(list)) return []
  const models: AiModel[] = []
  for (const entry of list) {
    const model = record(entry)
    const key = str(model?.key)
    if (!model || !key || model.type !== 'llm') continue
    const loadedContexts = contextsOf(model.loaded_instances)
    const reasoning = record(record(model.capabilities)?.reasoning)
    const options = reasoning?.allowed_options
    models.push({
      key,
      label: str(model.display_name) || key,
      maxContext: num(model.max_context_length),
      loadedContext: loadedContexts[0],
      loadedContexts,
      reasoningOptions: Array.isArray(options)
        ? options.filter((option): option is string => typeof option === 'string')
        : undefined,
      reasoningDefault: str(reasoning?.default)
    })
  }
  return models
}

/** The loaded instances of `modelKey`: their ids and contexts. */
export function loadedInstances(raw: unknown, modelKey: string): { id: string; context: number }[] {
  const list = record(raw)?.models
  if (!Array.isArray(list)) return []
  const model = list.map(record).find((entry) => entry?.key === modelKey)
  const instances = model?.loaded_instances
  if (!Array.isArray(instances)) return []
  return instances.flatMap((instance) => {
    const id = str(record(instance)?.id)
    const context = num(record(record(instance)?.config)?.context_length)
    return id && context !== undefined ? [{ id, context }] : []
  })
}

/**
 * Which instances to unload before asking for `contextLength`. LM Studio
 * answers with an instance of exactly that size if one is loaded; otherwise it
 * loads a new one and keeps manually loaded smaller ones beside it, which
 * would hold the model in memory twice. The smaller ones are no use, so they
 * go; larger ones are left alone.
 */
export function instancesToUnload(
  instances: { id: string; context: number }[],
  contextLength: number
): string[] {
  if (instances.some((instance) => instance.context === contextLength)) return []
  return instances.filter((instance) => instance.context < contextLength).map(({ id }) => id)
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${name} must be text.`)
  return value
}

/** Checks a request from the renderer. Throws with the reason when it is not valid. */
export function parseChatRequest(value: unknown): AiChatRequest {
  const candidate = record(value)
  if (!candidate) throw new Error('The AI request must be an object.')
  const { requestId, model, input } = candidate
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > AI_LIMITS.requestId ||
    !/^[A-Za-z0-9_-]+$/.test(requestId)
  ) {
    throw new Error('requestId must be 1–100 letters, digits, "-" or "_".')
  }
  if (typeof model !== 'string' || model.length < 1 || model.length > AI_LIMITS.model) {
    throw new Error(`model must be 1–${AI_LIMITS.model} characters.`)
  }
  if (typeof input !== 'string' || input.length === 0) throw new Error('input must be text.')
  const systemPrompt = optionalString(candidate.systemPrompt, 'systemPrompt')
  if (input.length + (systemPrompt?.length ?? 0) > AI_LIMITS.text) {
    throw new Error('input and systemPrompt are too long together (2 MB at most).')
  }
  const previousResponseId = optionalString(candidate.previousResponseId, 'previousResponseId')
  if (previousResponseId !== undefined && !RESPONSE_ID.test(previousResponseId)) {
    throw new Error('previousResponseId is not a response id.')
  }
  const contextLength = candidate.contextLength ?? undefined
  if (
    contextLength !== undefined &&
    (typeof contextLength !== 'number' ||
      !Number.isInteger(contextLength) ||
      contextLength < AI_LIMITS.contextLength.min ||
      contextLength > AI_LIMITS.contextLength.max)
  ) {
    throw new Error(
      `contextLength must be a whole number from ${AI_LIMITS.contextLength.min} to ${AI_LIMITS.contextLength.max}.`
    )
  }
  const reasoning = candidate.reasoning ?? undefined
  if (reasoning !== undefined && !(AI_REASONING_VALUES as readonly unknown[]).includes(reasoning)) {
    throw new Error(`reasoning must be one of ${AI_REASONING_VALUES.join(', ')}.`)
  }
  const request: AiChatRequest = { requestId, model, input }
  if (systemPrompt) request.systemPrompt = systemPrompt
  if (previousResponseId) request.previousResponseId = previousResponseId
  if (contextLength !== undefined) request.contextLength = contextLength as number
  if (reasoning !== undefined) request.reasoning = reasoning as AiReasoning
  return request
}

/** The body of `POST /api/v1/chat` for a request. */
export function chatBody(request: AiChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.input,
    stream: true,
    store: true
  }
  if (request.systemPrompt) body.system_prompt = request.systemPrompt
  if (request.previousResponseId) body.previous_response_id = request.previousResponseId
  if (request.contextLength !== undefined) body.context_length = request.contextLength
  if (request.reasoning !== undefined) body.reasoning = request.reasoning
  return body
}
