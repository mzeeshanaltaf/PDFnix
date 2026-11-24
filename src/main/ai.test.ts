import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiEvent } from '../shared/ai'
import { createAiClient, type AiClient, type AiClientOptions } from './ai'
import { MESSAGES } from './ai-protocol'
import { ERRORS, EVENTS, MODELS_RESPONSE, recordedStream, sse } from './lmstudio-fixtures'

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void

interface Recorded {
  method: string
  url: string
  body: unknown
}

/** A stand-in for LM Studio on a random port. */
class FakeLmStudio {
  server: Server
  requests: Recorded[] = []
  /** Resolves when the client closes a chat connection. */
  chatClosed: Promise<void>
  routes = new Map<string, Handler>()
  private closedChat!: () => void

  constructor() {
    this.chatClosed = new Promise((resolve) => (this.closedChat = resolve))
    this.server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        this.requests.push({
          method: request.method ?? '',
          url: request.url ?? '',
          body: body ? JSON.parse(body) : undefined
        })
        if (request.url === '/api/v1/chat') response.on('close', () => this.closedChat())
        const handler = this.routes.get(`${request.method} ${request.url}`)
        if (handler) handler(request, response, body)
        else json(response, 404, ERRORS.unknownEndpoint)
      })
    })
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  stop(): Promise<void> {
    this.server.closeAllConnections()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  chatBodies(): Record<string, unknown>[] {
    return this.requests
      .filter((request) => request.url === '/api/v1/chat')
      .map((request) => request.body as Record<string, unknown>)
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function startStream(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
}

const MODEL = 'google/gemma-4-26b-a4b'
const request = (
  extra: Record<string, unknown> = {}
): Parameters<ReturnType<typeof createAiClient>['chat']>[0] => ({
  requestId: 'r1',
  model: MODEL,
  input: 'Say goodbye',
  ...extra
})

let lm: FakeLmStudio
let url: string

beforeEach(async () => {
  lm = new FakeLmStudio()
  url = await lm.start()
})

afterEach(async () => {
  await lm.stop()
})

function client(options: Partial<AiClientOptions> = {}): AiClient {
  return createAiClient({ serverUrl: () => url, ...options })
}

async function run(
  ai: ReturnType<typeof createAiClient>,
  req = request()
): Promise<{ events: AiEvent[]; result: AiEvent }> {
  const events: AiEvent[] = []
  const result = await ai.chat(req, (event) => events.push(event))
  return { events, result }
}

function terminals(events: AiEvent[]): AiEvent[] {
  return events.filter((event) => event.type === 'done' || event.type === 'error')
}

describe('listModels', () => {
  it('lists the chat models', async () => {
    lm.routes.set('GET /api/v1/models', (_req, res) => json(res, 200, MODELS_RESPONSE))

    const info = await client().listModels()

    expect(info.reachable).toBe(true)
    expect(info.url).toBe(url)
    expect(info.error).toBeUndefined()
    expect(info.models.map((model) => [model.key, model.loadedContext])).toEqual([[MODEL, 16384]])
  })

  it('reports an unreachable server quickly', async () => {
    await lm.stop()
    const started = Date.now()

    const info = await client().listModels()

    expect(info).toEqual({
      reachable: false,
      url,
      error: { code: 'unreachable', message: MESSAGES.unreachable },
      models: []
    })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('reports a server that does not answer within the time limit as not running', async () => {
    lm.routes.set('GET /api/v1/models', () => {}) // never answers

    const info = await client({ listTimeoutMs: 150 }).listModels()

    expect(info.reachable).toBe(false)
    expect(info.error?.code).toBe('unreachable')
  })

  it('asks for a newer LM Studio when /api/v1 is missing', async () => {
    const info = await client().listModels()

    expect(info.reachable).toBe(true)
    expect(info.error?.code).toBe('outdated')
    expect(info.models).toEqual([])
  })
})

describe('chat', () => {
  it('streams an answer in order and ends with the response id', async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.write(sse(...EVENTS.modelLoadStart))
      res.write(sse(...EVENTS.modelLoadProgress))
      res.write(sse(...EVENTS.modelLoadEnd))
      res.end(recordedStream())
    })

    const { events, result } = await run(client())

    expect(events.filter((event) => event.type === 'status')).toEqual([
      { type: 'status', stage: 'loading', progress: 0 },
      { type: 'status', stage: 'loading', progress: 0.019801 },
      { type: 'status', stage: 'reading', progress: 0 },
      { type: 'status', stage: 'reading', progress: 0.9384615384615385 },
      { type: 'status', stage: 'reading', progress: 1 }
    ])
    const text = events.map((event) => (event.type === 'delta' ? event.text : '')).join('')
    expect(text).toBe('Au revoir. Vous avez demandé de dire bonjour.')
    expect(events.at(-1)).toBe(result)
    expect(terminals(events)).toEqual([result])
    expect(result).toMatchObject({
      type: 'done',
      responseId: 'resp_68fcb0c66b244978e40a7447635debfad7691ea09c49ab8e'
    })
    // Status before deltas, deltas before the end.
    const kinds = events.map((event) => event.type)
    expect(kinds.lastIndexOf('status')).toBeLessThan(kinds.indexOf('delta'))
  })

  it('passes thinking on and skips status events that barely moved', async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      for (let i = 0; i <= 1000; i++) {
        const data = { type: 'model_load.progress', progress: i / 1000 }
        res.write(sse('model_load.progress', JSON.stringify(data)))
      }
      res.write(sse(...EVENTS.reasoningStart))
      res.write(sse(...EVENTS.reasoningDelta))
      res.end(recordedStream())
    })

    const { events } = await run(client())

    const loading = events.filter((event) => event.type === 'status' && event.stage === 'loading')
    expect(loading.length).toBeGreaterThan(90)
    expect(loading.length).toBeLessThanOrEqual(102)
    expect(loading.at(-1)).toEqual({ type: 'status', stage: 'loading', progress: 1 })
    expect(events).toContainEqual({ type: 'thinking', text: '*' })
  })

  it('sends context_length and previous_response_id only when given', async () => {
    lm.routes.set('GET /api/v1/models', (_req, res) => json(res, 200, MODELS_RESPONSE))
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.end(recordedStream())
    })
    const ai = client()

    await run(ai, request({ systemPrompt: 'Answer in French.' }))
    await run(
      ai,
      request({
        previousResponseId: 'resp_68fcb0c66b244978e40a7447635debfad7691ea09c49ab8e',
        contextLength: 16384,
        reasoning: 'off'
      })
    )

    expect(lm.chatBodies()).toEqual([
      {
        model: MODEL,
        input: 'Say goodbye',
        system_prompt: 'Answer in French.',
        stream: true,
        store: true
      },
      {
        model: MODEL,
        input: 'Say goodbye',
        previous_response_id: 'resp_68fcb0c66b244978e40a7447635debfad7691ea09c49ab8e',
        context_length: 16384,
        reasoning: 'off',
        stream: true,
        store: true
      }
    ])
    // 16,384 is loaded already, so nothing was unloaded.
    expect(lm.requests.some((r) => r.url === '/api/v1/models/unload')).toBe(false)
  })

  it("unloads the model's smaller instances before asking for a bigger context", async () => {
    lm.routes.set('GET /api/v1/models', (_req, res) => json(res, 200, MODELS_RESPONSE))
    lm.routes.set('POST /api/v1/models/unload', (_req, res, body) =>
      json(res, 200, { instance_id: JSON.parse(body).instance_id })
    )
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.end(recordedStream())
    })

    const { events, result } = await run(client(), request({ contextLength: 32768 }))

    expect(lm.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /api/v1/models',
      'POST /api/v1/models/unload',
      'POST /api/v1/models/unload',
      'POST /api/v1/chat'
    ])
    expect(lm.requests.filter((r) => r.url.endsWith('unload')).map((r) => r.body)).toEqual([
      { instance_id: MODEL },
      { instance_id: `${MODEL}:2` }
    ])
    expect(lm.chatBodies()[0].context_length).toBe(32768)
    expect(events[0]).toEqual({ type: 'status', stage: 'loading', progress: 0 })
    expect(result.type).toBe('done')
  })

  it('cancels mid-stream with one terminal event and closes the connection', async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.write(sse(...EVENTS.messageDelta)) // and then nothing: a long answer
    })
    const ai = client()
    const events: AiEvent[] = []
    let cancelled = false
    const result = await ai.chat(request(), (event) => {
      events.push(event)
      if (event.type === 'delta' && !cancelled) cancelled = ai.cancel('r1')
    })

    expect(cancelled).toBe(true)
    expect(result).toEqual({ type: 'done', cancelled: true })
    expect(terminals(events)).toEqual([result])
    await lm.chatClosed
    expect(ai.cancel('r1')).toBe(false)
  })

  it("cancels a window's requests together", async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.write(sse(...EVENTS.messageDelta))
    })
    const ai = client()
    const started = new Set<string>()
    const results = Promise.all(
      ['a', 'b'].map((id) =>
        ai.chat(
          request({ requestId: id }),
          (event) => {
            if (event.type === 'delta') started.add(id)
            if (started.size === 2) ai.cancelOwner('window-1')
          },
          'window-1'
        )
      )
    )

    expect(await results).toEqual([
      { type: 'done', cancelled: true },
      { type: 'done', cancelled: true }
    ])
  })

  it('reports an error event mid-stream once, ignoring the end that follows', async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.write(sse(...EVENTS.messageDelta))
      res.write(sse(...EVENTS.error))
      res.end(sse(...EVENTS.chatEnd))
    })

    const { events, result } = await run(client())

    expect(result).toEqual({
      type: 'error',
      error: { code: 'server_error', message: '"model" is required' }
    })
    expect(terminals(events)).toEqual([result])
  })

  it('reports a stream that ends without an answer', async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.end(sse(...EVENTS.chatStart))
    })

    const { result } = await run(client())

    expect(result).toEqual({
      type: 'error',
      error: { code: 'stream_ended', message: MESSAGES.streamEnded }
    })
  })

  it('reports HTTP errors before the stream', async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => json(res, 400, ERRORS.outOfMemory))

    const { events, result } = await run(client())

    expect(result.type === 'error' && result.error.code).toBe('out_of_memory')
    expect(events).toEqual([result])
  })

  it('reports a server without /api/v1', async () => {
    const { result } = await run(client())

    expect(result).toEqual({
      type: 'error',
      error: { code: 'outdated', message: 'Update LM Studio to version 0.4 or newer.' }
    })
  })

  it('reports an unreachable server', async () => {
    await lm.stop()

    const { result } = await run(client())

    expect(result).toEqual({
      type: 'error',
      error: { code: 'unreachable', message: MESSAGES.unreachable }
    })
  })

  it('gives up when LM Studio goes silent', async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.write(sse(...EVENTS.messageDelta))
    })

    const { events, result } = await run(client({ idleTimeoutMs: 100 }))

    expect(result).toEqual({ type: 'error', error: { code: 'timeout', message: MESSAGES.timeout } })
    expect(terminals(events)).toEqual([result])
    await lm.chatClosed
  })

  it('allows more silence before the answer starts than during it', async () => {
    lm.routes.set('POST /api/v1/chat', (_req, res) => {
      startStream(res)
      res.write(sse(...EVENTS.modelLoadStart))
      setTimeout(() => res.end(recordedStream()), 250)
    })

    const { result } = await run(client({ firstEventTimeoutMs: 1000, idleTimeoutMs: 100 }))

    expect(result.type).toBe('done')
  })
})
