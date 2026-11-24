import { describe, expect, it } from 'vitest'
import {
  chatBody,
  filterModels,
  friendlyError,
  instancesToUnload,
  loadedInstances,
  MESSAGES,
  parseChatRequest,
  parseSse,
  toAiEvent,
  type SseEvent
} from './ai-protocol'
import { ERRORS, EVENTS, MODELS_RESPONSE, recordedStream } from './lmstudio-fixtures'

/** Feeds `bytes` to parseSse in pieces cut at `cuts`, decoding like the client does. */
function parseInPieces(bytes: Uint8Array, cuts: number[]): { events: SseEvent[]; rest: string } {
  const decoder = new TextDecoder()
  const events: SseEvent[] = []
  let rest = ''
  let start = 0
  for (const end of [...cuts, bytes.length]) {
    const parsed = parseSse(rest, decoder.decode(bytes.subarray(start, end), { stream: true }))
    events.push(...parsed.events)
    rest = parsed.rest
    start = end
  }
  return { events, rest }
}

describe('parseSse', () => {
  const stream = recordedStream()
  const bytes = new TextEncoder().encode(stream)
  const whole = parseSse('', stream)

  it('reads a recorded stream', () => {
    expect(whole.rest).toBe('')
    expect(whole.events).toHaveLength(20)
    expect(whole.events[0]).toEqual({ event: EVENTS.chatStart[0], data: EVENTS.chatStart[1] })
    expect(whole.events.at(-1)).toEqual({ event: 'chat.end', data: EVENTS.chatEnd[1] })
  })

  it('gives the same events however the bytes are split', () => {
    // "demandé" puts a two-byte character in the stream, so some cuts split it.
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(parseInPieces(bytes, [cut]).events).toEqual(whole.events)
    }
  })

  it('gives the same events fed one byte at a time', () => {
    const cuts = Array.from({ length: bytes.length - 1 }, (_, i) => i + 1)
    expect(parseInPieces(bytes, cuts)).toEqual(whole)
  })

  it('handles CRLF line ends, also split between CR and LF', () => {
    const crlf = new TextEncoder().encode(stream.replace(/\n/g, '\r\n'))
    for (let cut = 1; cut < crlf.length; cut += 7) {
      expect(parseInPieces(crlf, [cut]).events).toEqual(whole.events)
    }
  })

  it('keeps an unfinished event for later and skips comments and empty data', () => {
    const first = parseSse('', ': keep-alive\n\nevent: x\n\nevent: message.delta\ndata: {"a"')
    expect(first.events).toEqual([])
    const second = parseSse(first.rest, ':1}\n\n')
    expect(second.events).toEqual([{ event: 'message.delta', data: '{"a":1}' }])
  })

  it('joins several data lines and defaults the event name', () => {
    expect(parseSse('', 'data: a\ndata:b\n\n').events).toEqual([{ event: 'message', data: 'a\nb' }])
  })
})

describe('toAiEvent', () => {
  const event = ([name, data]: readonly [string, string]): ReturnType<typeof toAiEvent> =>
    toAiEvent({ event: name, data }, 'google/gemma-4-26b-a4b')

  it('maps loading and reading progress', () => {
    expect(event(EVENTS.modelLoadStart)).toEqual({ type: 'status', stage: 'loading', progress: 0 })
    expect(event(EVENTS.modelLoadProgress)).toEqual({
      type: 'status',
      stage: 'loading',
      progress: 0.019801
    })
    expect(event(EVENTS.promptStart)).toEqual({ type: 'status', stage: 'reading', progress: 0 })
    expect(event(EVENTS.promptProgress)).toEqual({
      type: 'status',
      stage: 'reading',
      progress: 0.9384615384615385
    })
  })

  it('maps reasoning and answer pieces', () => {
    expect(event(EVENTS.reasoningDelta)).toEqual({ type: 'thinking', text: '*' })
    expect(event(EVENTS.messageDelta)).toEqual({ type: 'delta', text: ' avez' })
  })

  it('maps the end with the response id and stats', () => {
    expect(event(EVENTS.chatEnd)).toEqual({
      type: 'done',
      responseId: 'resp_68fcb0c66b244978e40a7447635debfad7691ea09c49ab8e',
      stats: {
        inputTokens: 65,
        outputTokens: 12,
        reasoningTokens: 0,
        tokensPerSecond: 56.19986716395035,
        timeToFirstTokenSeconds: 0.531,
        modelLoadSeconds: undefined
      }
    })
  })

  it('maps an error event to the server message', () => {
    expect(event(EVENTS.error)).toEqual({
      type: 'error',
      error: { code: 'server_error', message: '"model" is required' }
    })
  })

  it('ignores the events the app does not use and broken data', () => {
    for (const ignored of [
      EVENTS.chatStart,
      EVENTS.modelLoadEnd,
      EVENTS.promptEnd,
      EVENTS.reasoningStart,
      EVENTS.reasoningEnd,
      EVENTS.messageStart,
      EVENTS.messageEnd
    ]) {
      expect(event(ignored)).toBeNull()
    }
    expect(toAiEvent({ event: 'tool_call.start', data: '{}' })).toBeNull()
    expect(toAiEvent({ event: 'message.delta', data: 'not json' })).toBeNull()
    expect(toAiEvent({ event: 'message.delta', data: '{"content":""}' })).toBeNull()
  })
})

describe('friendlyError', () => {
  const model = 'google/gemma-4-26b-a4b'

  it('says the server is not running when nothing answers', () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1234'), {
        code: 'ECONNREFUSED'
      })
    })
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(friendlyError({ cause: refused })).toEqual({
      code: 'unreachable',
      message: MESSAGES.unreachable
    })
    expect(friendlyError({ cause: timeout }).code).toBe('unreachable')
  })

  it('asks for a newer LM Studio when /api/v1 is missing', () => {
    expect(friendlyError({ status: 404, body: ERRORS.unknownEndpoint })).toEqual({
      code: 'outdated',
      message: 'Update LM Studio to version 0.4 or newer.'
    })
    expect(friendlyError({ status: 404, body: 'Cannot GET /api/v1/models' }).code).toBe('outdated')
  })

  it('names a model that is not available', () => {
    expect(friendlyError({ status: 404, body: ERRORS.modelNotFound, model: 'nope/model' })).toEqual(
      { code: 'model_not_found', message: "The model “nope/model” isn't available in LM Studio." }
    )
  })

  it('explains a model that does not fit in memory', () => {
    const error = friendlyError({ status: 400, body: ERRORS.outOfMemory, model })
    expect(error.code).toBe('out_of_memory')
    expect(error.message).toBe(
      `Not enough memory to load “${model}” at this context size. Lower 'Largest context' in Settings or choose a smaller model.`
    )
  })

  it('reports an expired conversation by its code', () => {
    expect(friendlyError({ status: 400, body: ERRORS.responseNotFound }).code).toBe(
      'conversation_expired'
    )
  })

  it("passes anything else on as the server's message, cut to 300 characters", () => {
    expect(friendlyError({ status: 400, body: ERRORS.badReasoning })).toEqual({
      code: 'server_error',
      message: ERRORS.badReasoning.error.message
    })
    const long = friendlyError({ status: 500, body: { error: { message: 'x'.repeat(500) } } })
    expect(long.message).toHaveLength(300)
    expect(friendlyError({ status: 500, body: '' }).message).toBe(
      'LM Studio answered with HTTP 500.'
    )
    expect(friendlyError({ status: 500, body: ERRORS.contextOverflow }).message).toMatch(
      /greater than the context length/
    )
    expect(friendlyError({ cause: new Error('boom') })).toEqual({
      code: 'server_error',
      message: 'boom'
    })
  })
})

describe('filterModels', () => {
  it('keeps chat models with their loaded sizes and reasoning options', () => {
    expect(filterModels(MODELS_RESPONSE)).toEqual([
      {
        key: 'google/gemma-4-26b-a4b',
        label: 'Gemma 4 26B A4B',
        maxContext: 262144,
        loadedContext: 16384,
        loadedContexts: [16384, 8192],
        reasoningOptions: ['off', 'on'],
        reasoningDefault: 'on'
      }
    ])
  })

  it('treats a model with no loaded instances as not loaded', () => {
    const raw = {
      models: [{ type: 'llm', key: 'a/b', loaded_instances: [], max_context_length: 4096 }]
    }
    expect(filterModels(raw)).toEqual([
      {
        key: 'a/b',
        label: 'a/b',
        maxContext: 4096,
        loadedContext: undefined,
        loadedContexts: [],
        reasoningOptions: undefined,
        reasoningDefault: undefined
      }
    ])
  })

  it('copes with anything that is not a model list', () => {
    expect(filterModels(null)).toEqual([])
    expect(filterModels({ models: 'x' })).toEqual([])
    expect(filterModels({ models: [null, { type: 'llm' }] })).toEqual([])
  })
})

describe('instances to unload', () => {
  const instances = loadedInstances(MODELS_RESPONSE, 'google/gemma-4-26b-a4b')

  it('reads the loaded instances of one model', () => {
    expect(instances).toEqual([
      { id: 'google/gemma-4-26b-a4b', context: 8192 },
      { id: 'google/gemma-4-26b-a4b:2', context: 16384 }
    ])
    expect(loadedInstances(MODELS_RESPONSE, 'other')).toEqual([])
  })

  it('unloads nothing when an instance has exactly the size', () => {
    expect(instancesToUnload(instances, 16384)).toEqual([])
    expect(instancesToUnload(instances, 8192)).toEqual([])
  })

  it('unloads the smaller instances when a bigger size is needed', () => {
    expect(instancesToUnload(instances, 32768)).toEqual([
      'google/gemma-4-26b-a4b',
      'google/gemma-4-26b-a4b:2'
    ])
    expect(instancesToUnload(instances, 12288)).toEqual(['google/gemma-4-26b-a4b'])
  })
})

describe('parseChatRequest', () => {
  const valid = { requestId: 'r-1', model: 'google/gemma-4-26b-a4b', input: 'Define cat' }

  it('accepts a valid request and drops empty optional fields', () => {
    expect(parseChatRequest({ ...valid, systemPrompt: '', previousResponseId: null })).toEqual(
      valid
    )
    const full = {
      ...valid,
      systemPrompt: 'Be brief.',
      previousResponseId: 'resp_68fcb0c66b244978e40a7447635debfad7691ea09c49ab8e',
      contextLength: 12288,
      reasoning: 'off'
    }
    expect(parseChatRequest(full)).toEqual(full)
  })

  it.each([
    ['not an object', 'x'],
    ['a bad request id', { ...valid, requestId: 'a b' }],
    ['an empty request id', { ...valid, requestId: '' }],
    ['an empty model', { ...valid, model: '' }],
    ['a long model', { ...valid, model: 'm'.repeat(201) }],
    ['an empty input', { ...valid, input: '' }],
    [
      'too much text',
      { ...valid, input: 'x'.repeat(1_500_000), systemPrompt: 'y'.repeat(600_000) }
    ],
    ['a bad response id', { ...valid, previousResponseId: 'resp_../x' }],
    ['a response id without prefix', { ...valid, previousResponseId: 'abc' }],
    ['a small context', { ...valid, contextLength: 1024 }],
    ['a huge context', { ...valid, contextLength: 300_000 }],
    ['a fractional context', { ...valid, contextLength: 4096.5 }],
    ['an unknown reasoning value', { ...valid, reasoning: 'max' }],
    ['a system prompt that is not text', { ...valid, systemPrompt: 5 }]
  ])('refuses %s', (_name, request) => {
    expect(() => parseChatRequest(request)).toThrow()
  })
})

describe('chatBody', () => {
  it('sends only what was asked for', () => {
    expect(chatBody({ requestId: 'r', model: 'm', input: 'hi' })).toEqual({
      model: 'm',
      input: 'hi',
      stream: true,
      store: true
    })
    expect(
      chatBody({
        requestId: 'r',
        model: 'm',
        input: 'hi',
        systemPrompt: 'sys',
        previousResponseId: 'resp_1',
        contextLength: 8192,
        reasoning: 'off'
      })
    ).toEqual({
      model: 'm',
      input: 'hi',
      stream: true,
      store: true,
      system_prompt: 'sys',
      previous_response_id: 'resp_1',
      context_length: 8192,
      reasoning: 'off'
    })
  })
})
