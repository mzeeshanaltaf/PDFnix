/**
 * Payloads recorded from LM Studio 0.4.16 on 2026-11-24 (phase 9, task 1),
 * with google/gemma-4-26b-a4b. Used by the tests only; the app never imports
 * this module.
 */

/** `GET /api/v1/models` with gemma-4 loaded twice (8,192 and 16,384 tokens) and an embedding model. */
export const MODELS_RESPONSE = {
  models: [
    {
      type: 'llm',
      publisher: 'google',
      key: 'google/gemma-4-26b-a4b',
      display_name: 'Gemma 4 26B A4B',
      architecture: 'gemma4',
      quantization: { name: 'Q4_K_M', bits_per_weight: 4 },
      size_bytes: 17990939153,
      params_string: '26B-A4B',
      loaded_instances: [
        {
          id: 'google/gemma-4-26b-a4b',
          config: {
            context_length: 8192,
            eval_batch_size: 2048,
            physical_batch_size: 512,
            parallel: 4,
            flash_attention: true,
            num_experts: 8,
            offload_kv_cache_to_gpu: true
          }
        },
        {
          id: 'google/gemma-4-26b-a4b:2',
          config: {
            context_length: 16384,
            eval_batch_size: 2048,
            physical_batch_size: 512,
            parallel: 4,
            flash_attention: true,
            num_experts: 8,
            offload_kv_cache_to_gpu: true
          },
          remaining_ttl_seconds: 3590
        }
      ],
      max_context_length: 262144,
      format: 'gguf',
      capabilities: {
        vision: true,
        trained_for_tool_use: true,
        reasoning: { allowed_options: ['off', 'on'], default: 'on' }
      },
      description: null,
      variants: ['google/gemma-4-26b-a4b@q4_k_m'],
      selected_variant: 'google/gemma-4-26b-a4b@q4_k_m'
    },
    {
      type: 'embedding',
      publisher: 'nomic-ai',
      key: 'text-embedding-nomic-embed-text-v1.5',
      display_name: 'Nomic Embed Text v1.5',
      quantization: { name: 'Q4_K_M', bits_per_weight: 4 },
      size_bytes: 84106624,
      params_string: null,
      loaded_instances: [],
      max_context_length: 2048,
      format: 'gguf'
    }
  ]
}

/** One recorded event each: `[event, data]`. */
export const EVENTS = {
  chatStart: ['chat.start', '{"type":"chat.start","model_instance_id":"google/gemma-4-26b-a4b"}'],
  modelLoadStart: [
    'model_load.start',
    '{"type":"model_load.start","model_instance_id":"google/gemma-4-26b-a4b"}'
  ],
  modelLoadProgress: [
    'model_load.progress',
    '{"type":"model_load.progress","model_instance_id":"google/gemma-4-26b-a4b","progress":0.019801}'
  ],
  modelLoadEnd: [
    'model_load.end',
    '{"type":"model_load.end","model_instance_id":"google/gemma-4-26b-a4b","load_time_seconds":26.946}'
  ],
  promptStart: ['prompt_processing.start', '{"type":"prompt_processing.start"}'],
  promptProgress: [
    'prompt_processing.progress',
    '{"type":"prompt_processing.progress","progress":0.9384615384615385}'
  ],
  promptEnd: ['prompt_processing.end', '{"type":"prompt_processing.end"}'],
  reasoningStart: ['reasoning.start', '{"type":"reasoning.start"}'],
  reasoningDelta: ['reasoning.delta', '{"type":"reasoning.delta","content":"*"}'],
  reasoningEnd: ['reasoning.end', '{"type":"reasoning.end"}'],
  messageStart: ['message.start', '{"type":"message.start"}'],
  messageDelta: ['message.delta', '{"type":"message.delta","content":" avez"}'],
  messageEnd: ['message.end', '{"type":"message.end"}'],
  chatEnd: [
    'chat.end',
    '{"type":"chat.end","result":{"model_instance_id":"google/gemma-4-26b-a4b","output":[{"type":"message","content":"Au revoir. Vous avez demandé de dire bonjour."}],"stats":{"input_tokens":65,"total_output_tokens":12,"reasoning_output_tokens":0,"tokens_per_second":56.19986716395035,"time_to_first_token_seconds":0.531},"response_id":"resp_68fcb0c66b244978e40a7447635debfad7691ea09c49ab8e"}}'
  ],
  /** Documented shape (not seen live): LM Studio's docs, "Streaming events". */
  error: [
    'error',
    '{"type":"error","error":{"type":"invalid_request","message":"\\"model\\" is required","code":"missing_required_parameter","param":"model"}}'
  ]
} as const satisfies Record<string, readonly [string, string]>

/** A recorded answer to a follow-up question, as LM Studio streamed it. */
export function recordedStream(): string {
  const deltas = [
    'Au',
    ' re',
    'voir',
    '.',
    ' Vous',
    ' avez',
    ' demandé',
    ' de',
    ' dire',
    ' bonjour',
    '.'
  ]
  const events: (readonly [string, string])[] = [
    EVENTS.chatStart,
    EVENTS.promptStart,
    ['prompt_processing.progress', '{"type":"prompt_processing.progress","progress":0}'],
    EVENTS.promptProgress,
    ['prompt_processing.progress', '{"type":"prompt_processing.progress","progress":1}'],
    EVENTS.promptEnd,
    EVENTS.messageStart,
    ...deltas.map(
      (content) => ['message.delta', JSON.stringify({ type: 'message.delta', content })] as const
    ),
    EVENTS.messageEnd,
    EVENTS.chatEnd
  ]
  return events.map(([event, data]) => sse(event, data)).join('')
}

export function sse(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

/** HTTP error bodies, as recorded. */
export const ERRORS = {
  unknownEndpoint: { error: 'Unexpected endpoint or method. (GET /api/v1/nonexistent)' },
  modelNotFound: {
    error: {
      message:
        'Invalid model identifier "nope/model". Please specify a valid downloaded model (e.g., google/gemma-4-26b-a4b@q4_k_m, google/gemma-4-26b-a4b, gemma-4-26b-a4b-it).',
      type: 'invalid_request',
      param: 'model',
      code: 'model_not_found'
    }
  },
  responseNotFound: {
    error: {
      message:
        "Could not find stored response for previous_response_id 'resp_doesnotexist123'. Please ensure the ID is correct. Current previous response auto-deletion policy: Responses older than 30 days are automatically deleted.",
      type: 'invalid_request',
      param: 'previous_response_id',
      code: 'invalid_value'
    }
  },
  badReasoning: {
    error: {
      message:
        "Reasoning setting 'high' is not supported by model 'google/gemma-4-26b-a4b'. Supported settings: 'off', 'on'.",
      type: 'invalid_request',
      param: 'reasoning',
      code: 'invalid_value'
    }
  },
  outOfMemory: {
    error: {
      message:
        'Failed to load model "google/gemma-4-26b-a4b". Error: Model loading was stopped due to insufficient system resources. Under the current settings, this model requires approximately 19.01 GB of memory, and continuing to load it would likely overload your system and cause it to freeze. If you think this is incorrect, you can adjust the model loading guardrails in settings.',
      type: 'invalid_request',
      param: 'model'
    }
  },
  contextOverflow: {
    error: {
      message:
        'The number of tokens to keep from the initial prompt is greater than the context length (n_keep: 9266>= n_ctx: 8192). Try to load the model with a larger context length, or provide a shorter input.',
      type: 'internal_error',
      code: 'unknown',
      param: null
    }
  }
}
