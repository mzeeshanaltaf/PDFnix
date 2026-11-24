/**
 * A stand-in for LM Studio's native API (`/api/v1`), for the assistant's
 * end-to-end tests. It answers like LM Studio 0.4.16 did when phase 9
 * recorded it (src/main/lmstudio-fixtures.ts) and keeps every request.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { EVENTS, MODELS_RESPONSE, sse } from '../../src/main/lmstudio-fixtures'

export interface RecordedRequest {
  method: string
  path: string
  body: Record<string, unknown> | null
}

export interface FakeLmStudio {
  url: string
  requests: RecordedRequest[]
  /** `/api/v1/chat` bodies, in order. */
  chats(): Record<string, unknown>[]
  /** Chat streams the app closed before they ended (Stop). */
  closedEarly: number
  /** The loaded instance's context; LM Studio "reloads" when another size is asked for. */
  loadedContext: number
  /** The answer's words; each is one `message.delta`. */
  answer: string[]
  /** Pause between answer words, in ms. */
  wordDelayMs: number
  close(): Promise<void>
}

const KEY = 'google/gemma-4-26b-a4b'

function modelsBody(loadedContext: number): unknown {
  const [gemma, embedding] = MODELS_RESPONSE.models
  return {
    models: [
      {
        ...gemma,
        loaded_instances: [
          {
            ...gemma.loaded_instances[0],
            config: { ...gemma.loaded_instances[0].config, context_length: loadedContext }
          }
        ]
      },
      embedding
    ]
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

export async function startFakeLmStudio(): Promise<FakeLmStudio> {
  let responses = 0
  const fake: FakeLmStudio = {
    url: '',
    requests: [],
    chats: () =>
      fake.requests
        .filter((request) => request.path === '/api/v1/chat')
        .map((request) => request.body ?? {}),
    closedEarly: 0,
    loadedContext: 8192,
    answer: ['Here', ' is', ' a', ' **simpler**', ' version.'],
    wordDelayMs: 40,
    close: () =>
      new Promise((done) => {
        server.close(() => done())
        server.closeAllConnections()
      })
  }

  async function streamChat(
    body: Record<string, unknown>,
    response: ServerResponse
  ): Promise<void> {
    let open = true
    response.on('close', () => {
      if (open) fake.closedEarly += 1
      open = false
    })
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const send = async (event: string, data: unknown, delay = 30): Promise<boolean> => {
      if (!open) return false
      response.write(sse(event, typeof data === 'string' ? data : JSON.stringify(data)))
      await pause(delay)
      return open
    }

    await send(EVENTS.chatStart[0], EVENTS.chatStart[1])
    const size = typeof body.context_length === 'number' ? body.context_length : fake.loadedContext
    if (size !== fake.loadedContext) {
      await send(EVENTS.modelLoadStart[0], EVENTS.modelLoadStart[1])
      for (const progress of [0.25, 0.5, 0.75, 1]) {
        await send(
          'model_load.progress',
          { type: 'model_load.progress', model_instance_id: KEY, progress },
          120
        )
      }
      await send(EVENTS.modelLoadEnd[0], EVENTS.modelLoadEnd[1])
      fake.loadedContext = size
    }
    await send(EVENTS.promptStart[0], EVENTS.promptStart[1])
    for (const progress of [0.3, 0.7, 1]) {
      await send(
        'prompt_processing.progress',
        { type: 'prompt_processing.progress', progress },
        150
      )
    }
    await send(EVENTS.promptEnd[0], EVENTS.promptEnd[1])
    await send(EVENTS.messageStart[0], EVENTS.messageStart[1])
    for (const content of fake.answer) {
      if (!(await send('message.delta', { type: 'message.delta', content }, fake.wordDelayMs)))
        return
    }
    await send(EVENTS.messageEnd[0], EVENTS.messageEnd[1])
    responses += 1
    const responseId = `resp_fake${String(responses).padStart(4, '0')}`
    await send('chat.end', {
      type: 'chat.end',
      result: {
        model_instance_id: KEY,
        output: [{ type: 'message', content: fake.answer.join('') }],
        stats: { input_tokens: 100, total_output_tokens: fake.answer.length },
        response_id: responseId
      }
    })
    open = false
    response.end()
  }

  const server = createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? '').split('?')[0]
      const body = request.method === 'POST' ? await readJson(request) : null
      fake.requests.push({ method: request.method ?? '', path, body })
      const json = (status: number, value: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(value))
      }
      if (request.method === 'GET' && path === '/api/v1/models') {
        json(200, modelsBody(fake.loadedContext))
      } else if (request.method === 'POST' && path === '/api/v1/models/unload') {
        json(200, { instance_id: body?.instance_id })
      } else if (request.method === 'POST' && path === '/api/v1/chat' && body) {
        await streamChat(body, response)
      } else {
        json(404, { error: `Unexpected endpoint or method. (${request.method} ${path})` })
      }
    })()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return fake
}
