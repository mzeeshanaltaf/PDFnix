/**
 * The LM Studio client: lists models and streams answers through LM Studio's
 * native API (`/api/v1`). Runs in main, never in the renderer (see the phase 9
 * plan, "Where AI calls run"). Free of Electron, so ai.test.ts runs it against
 * a fake server; ipc.ts wires it to the windows.
 *
 * The server address always comes from the settings (`serverUrl`), never from
 * the renderer.
 */

import type { AiChatRequest, AiEvent, AiServerInfo } from '../shared/ai'
import {
  chatBody,
  filterModels,
  friendlyError,
  instancesToUnload,
  loadedInstances,
  MESSAGES,
  parseSse,
  toAiEvent
} from './ai-protocol'

export type AiEmit = (event: AiEvent) => void

export interface AiClientOptions {
  /** The server address, e.g. `http://127.0.0.1:1234` (no trailing `/`). */
  serverUrl: () => string
  /** How long listing models may take before the server counts as not running. */
  listTimeoutMs?: number
  /** Silence allowed before the first piece of the answer (covers loading a model). */
  firstEventTimeoutMs?: number
  /** Silence allowed between events once the answer has started. */
  idleTimeoutMs?: number
  /** Time allowed for the model list and unloads done before a chat. */
  prepareTimeoutMs?: number
}

export interface AiClient {
  listModels(): Promise<AiServerInfo>
  /**
   * Streams an answer. `emit` gets every event, and exactly one terminal
   * event (`done`, `done` with `cancelled`, or `error`), which the promise
   * also resolves with. Never rejects.
   */
  chat(request: AiChatRequest, emit: AiEmit, owner?: string): Promise<AiEvent>
  /** Stops a request. False if it is not running. */
  cancel(requestId: string, owner?: string): boolean
  /** Stops every request of `owner` (a window that closed or reloaded). */
  cancelOwner(owner: string): void
}

const DEFAULT_OWNER = 'default'
/** Status events closer together than this much progress are not passed on. */
const PROGRESS_STEP = 0.01

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function createAiClient(options: AiClientOptions): AiClient {
  const listTimeoutMs = options.listTimeoutMs ?? 1500
  const firstEventTimeoutMs = options.firstEventTimeoutMs ?? 120_000
  const idleTimeoutMs = options.idleTimeoutMs ?? 60_000
  const prepareTimeoutMs = options.prepareTimeoutMs ?? 10_000
  const active = new Map<string, AbortController>()

  const keyOf = (owner: string, requestId: string): string => `${owner}\u0000${requestId}`

  async function listModels(): Promise<AiServerInfo> {
    const url = options.serverUrl()
    let response: Response
    let body: unknown
    try {
      // The timeout covers reading the body as well.
      response = await fetch(`${url}/api/v1/models`, {
        signal: AbortSignal.timeout(listTimeoutMs)
      })
      body = await readBody(response)
    } catch (cause) {
      return { reachable: false, url, error: friendlyError({ cause }), models: [] }
    }
    if (!response.ok) {
      return {
        reachable: true,
        url,
        error: friendlyError({ status: response.status, body }),
        models: []
      }
    }
    return { reachable: true, url, models: filterModels(body) }
  }

  /**
   * Unloads the model's instances that are smaller than `contextLength`
   * when none has exactly that size, so LM Studio loads one copy at the new
   * size instead of a second copy beside a manually loaded one. Problems here
   * are left for the chat request itself to report.
   */
  async function makeRoom(
    url: string,
    request: AiChatRequest & { contextLength: number },
    signal: AbortSignal,
    emit: AiEmit
  ): Promise<void> {
    const limited = AbortSignal.any([signal, AbortSignal.timeout(prepareTimeoutMs)])
    try {
      const response = await fetch(`${url}/api/v1/models`, { signal: limited })
      if (!response.ok) return
      const ids = instancesToUnload(
        loadedInstances(await response.json(), request.model),
        request.contextLength
      )
      if (ids.length === 0) return
      emit({ type: 'status', stage: 'loading', progress: 0 })
      for (const id of ids) {
        await fetch(`${url}/api/v1/models/unload`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instance_id: id }),
          signal: limited
        })
      }
    } catch (cause) {
      if (signal.aborted) throw cause
    }
  }

  async function chat(
    request: AiChatRequest,
    emit: AiEmit,
    owner: string = DEFAULT_OWNER
  ): Promise<AiEvent> {
    const key = keyOf(owner, request.requestId)
    active.get(key)?.abort()
    const controller = new AbortController()
    active.set(key, controller)

    let terminal: AiEvent | null = null
    const finish = (event: AiEvent): void => {
      if (terminal) return
      terminal = event
      emit(event)
    }
    const send = (event: AiEvent): void => {
      if (!terminal) emit(event)
    }

    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = (ms: number): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, ms)
    }

    try {
      const url = options.serverUrl()
      if (request.contextLength !== undefined) {
        await makeRoom(
          url,
          { ...request, contextLength: request.contextLength },
          controller.signal,
          send
        )
      }
      arm(firstEventTimeoutMs)
      const response = await fetch(`${url}/api/v1/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(chatBody(request)),
        signal: controller.signal
      })
      if (!response.ok || !response.body) {
        finish({
          type: 'error',
          error: friendlyError({
            status: response.status,
            body: await readBody(response),
            model: request.model
          })
        })
        return terminal ?? { type: 'done' }
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let answering = false
      let lastStatus: { stage: string; progress: number } | null = null
      while (!terminal) {
        const { value, done } = await reader.read()
        if (done) break
        const parsed = parseSse(buffer, decoder.decode(value, { stream: true }))
        buffer = parsed.rest
        for (const sse of parsed.events) {
          const event = toAiEvent(sse, request.model)
          if (event?.type === 'delta') answering = true
          arm(answering ? idleTimeoutMs : firstEventTimeoutMs)
          if (!event) continue
          if (event.type === 'done' || event.type === 'error') {
            finish(event)
            break
          }
          if (event.type === 'status') {
            const same = lastStatus?.stage === event.stage
            const small = same && Math.abs(event.progress - lastStatus!.progress) < PROGRESS_STEP
            if (small && event.progress < 1) continue
            lastStatus = { stage: event.stage, progress: event.progress }
          }
          send(event)
        }
      }
      if (terminal) {
        await reader.cancel().catch(() => {})
      } else {
        // LM Studio ends the stream without a word when the prompt does not
        // fit the loaded context (STATUS.md, "Verified facts").
        finish({ type: 'error', error: { code: 'stream_ended', message: MESSAGES.streamEnded } })
      }
    } catch (cause) {
      if (timedOut) {
        finish({ type: 'error', error: { code: 'timeout', message: MESSAGES.timeout } })
      } else if (controller.signal.aborted) {
        finish({ type: 'done', cancelled: true })
      } else {
        finish({ type: 'error', error: friendlyError({ cause, model: request.model }) })
      }
    } finally {
      clearTimeout(timer)
      if (active.get(key) === controller) active.delete(key)
    }
    return terminal ?? { type: 'done' }
  }

  function cancel(requestId: string, owner: string = DEFAULT_OWNER): boolean {
    const controller = active.get(keyOf(owner, requestId))
    if (!controller) return false
    controller.abort()
    return true
  }

  function cancelOwner(owner: string): void {
    const prefix = `${owner}\u0000`
    for (const [key, controller] of active) {
      if (key.startsWith(prefix)) controller.abort()
    }
  }

  return { listModels, chat, cancel, cancelOwner }
}
