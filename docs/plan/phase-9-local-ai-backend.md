# Phase 9 — Local AI Backend (LM Studio)

**Goal:** the main process can do three things with the user's local LM Studio server, through LM Studio's own REST API (`/api/v1`):
- find out whether the server is running;
- list its chat models;
- stream answers, which can be cancelled.

The request asks for a context size large enough for the text it sends. The engine provides the document text used as context. Settings store the server address, the model, the default context and a memory cap. A "Test connection" button in Settings checks the whole chain. The chat panel comes in phase 10.

**Depends on:** phase 8 (order only; nothing here uses the menu).

## Background

Phase 8's plan describes the feature and the user's decisions. On 2026-11-24 the user narrowed the AI part to **LM Studio only**: Ollama is not supported. The reasons:

- The user's models are in LM Studio.
- LM Studio's own API can set the context size in the request. The OpenAI-compatible endpoint (`/v1/chat/completions`) cannot. Setting the size per request was the main thing Ollama would have added.
- The API also reports progress while it loads the model and reads the prompt. The panel can show that progress instead of sitting silent.

Facts about the development machine, checked on 2026-11-24:

- LM Studio **0.4.16** is installed (`C:\Program Files\LM Studio`). It is registered to run as a service (`--run-as-service`), so it may already be running in the background.
- The `lms` CLI is at `%USERPROFILE%\.lmstudio\bin\lms.exe`.
- One model is downloaded: `lmstudio-community/gemma-4-26B-A4B-it-GGUF`.
- The server was not running when checked.
- LM Studio's native v1 API (`/api/v1/*`) was released in 0.4.0.

What the docs say (https://lmstudio.ai/docs/developer/rest, `/chat`, `/load`, `/streaming-events`, `/stateful-chats`):

**`POST /api/v1/chat`**
- Request body fields: `model`, `input` (a string, or an array of `{type:'text', content}` / `{type:'image', data_url}`), `system_prompt`, `stream`, `temperature`, `top_p`, `top_k`, `min_p`, `repeat_penalty`, `max_output_tokens`, `reasoning`, `context_length` ("Number of tokens to consider as context"), `store` (default true), `previous_response_id` (`resp_…`), and `integrations`.
- There is **no messages array**. Follow-up questions continue a conversation through `previous_response_id`.
- **Streaming** uses SSE with `event: <type>` and `data: <json>` lines. Event types, in order: `chat.start`, `model_load.start/progress/end`, `prompt_processing.start/progress/end`, `reasoning.start/delta/end`, `tool_call.*`, `message.start/delta/end`, `error`, `chat.end`.
- `chat.end` carries the same result the non-streaming response returns.
- `model_load.start` is "not emitted if the requested model is already loaded".

**`POST /api/v1/models/load`**
- Body: `{ model, context_length?, eval_batch_size?, flash_attention?, num_experts?, offload_kv_cache_to_gpu?, echo_load_config? }`.
- Response: `{ type, instance_id, load_time_seconds, status: 'loaded', load_config? }`.

**Not documented** (task 1 must find out):
- what `context_length` on `/chat` does when the model is already loaded at a different size;
- what `/load` does when the model is already loaded;
- the exact response of `GET /api/v1/models`;
- whether `system_prompt` carries over with `previous_response_id`;
- what `reasoning` accepts.

## Scope

Included:
- an LM Studio client in main;
- IPC for model listing, chat streaming and cancel;
- shared helpers for the context budget;
- an engine endpoint for a document's plain text;
- settings and a Settings section.

Not included:
- the chat panel, menu items and prompts (phase 10);
- Ollama or other servers;
- the OpenAI-compatible endpoint;
- cloud providers;
- retrieval or embeddings;
- tool calls / MCP integrations;
- images sent to vision models.

## Where AI calls run, and why

AI calls run in the **main process** (Node `fetch`), never in the renderer.

- The renderer's CSP allows only `http://127.0.0.1:*` (`localhost` doesn't match).
- LM Studio would also have to allow the renderer's origin through CORS. That origin is `null` in the built app and the dev-server origin in development, and LM Studio has CORS off by default.
- The engine is kept for PDF work.
- Main already does non-PDF system work, so the calls belong there.

The renderer never passes a URL. Main reads the server URL from settings, so a compromised renderer cannot make main fetch an arbitrary address.

## Tasks

### 1. Check the API against the installed LM Studio (first)

1. Start the server: `lms server start`, or LM Studio → Developer → Start server.
2. Write a throwaway script in the session's scratchpad, **not** in the repo, that calls the API and prints raw responses. Use the downloaded gemma-4 model.
3. Find out:
   1. **`GET /api/v1/models`**: its response shape, especially:
      - the model key/id;
      - type (llm vs embedding);
      - `max_context_length`;
      - loaded instances and the context length each was loaded with.
   2. **`POST /api/v1/chat` with `stream: true`**:
      - the exact `data` JSON of `message.delta`, `reasoning.delta`, `model_load.progress`, `prompt_processing.progress`, `error` and `chat.end`;
      - where `response_id` and token stats appear.
   3. **`context_length` on `/chat` while the model is loaded at a different size**:
      - Does LM Studio reload it, load a second copy, or ignore the field?
      - Check the model list before and after.
      - Also check a model that is not loaded yet (just-in-time load at that size?).
   4. **`POST /api/v1/models/load` for a model that is already loaded**: a second instance, an error, or a replacement? Is there an unload endpoint (`/api/v1/models/unload`?), and what does it take?
   5. **`previous_response_id`**:
      - Is the first turn's `system_prompt` still in effect on the next turn?
      - What happens with a different `model`?
      - What happens after an LM Studio restart (error code and text)?
   6. **`reasoning`**: which values it accepts and whether gemma-4 emits reasoning events.
   7. **Cancel**: does closing the connection mid-stream stop generation? Watch LM Studio's server log.
   8. **Errors**: the HTTP status and body for an unknown model, for a server below 0.4 (404 on `/api/v1`), and when the model doesn't fit in memory.
4. Record every answer under "Verified facts" in STATUS.md.
5. If an answer changes the design below (most likely 3c and 3e), adjust this plan and phase 10's, and record the change under "Deviations and decisions".

### 2. Shared helpers: `src/shared/ai.ts` (pure, used by main and renderer, unit-tested)

- **Types:**
  - `AiModel { key, label, maxContext?, loadedContext? }` (`loadedContext` undefined = not loaded);
  - `AiEvent` (below);
  - `AiChatRequest`.
- `estimateTokens(text)` = `ceil(chars / 3.5)`.
- `ANSWER_RESERVE = 1024` tokens.
- **`chooseContextLength({ neededTokens, loadedContext, maxContext, cap })`:**
  - If the model is loaded and `loadedContext ≥ needed`, return `undefined`: don't ask, so the model isn't reloaded.
  - Otherwise return `needed` rounded up to a multiple of 4,096, at least 4,096, at most `min(maxContext ?? cap, cap)`.
  - This is the rule if task 1 shows that `/chat`'s `context_length` reloads or loads at that size. If it is ignored for a loaded model, task 3 loads explicitly instead (see there), and this function still decides the size.
- **`excerptCharBudget({ contextTokens, otherTokens })`:** how many characters of document text fit next to the system prompt, the question and the answer reserve.

### 3. Client: `src/main/ai.ts`, with parsing in `src/main/ai-protocol.ts`

**`ai-protocol.ts` (pure):**
- `parseSse(buffer, chunk)` → `{ events: {event, data}[], rest }`. An event or line may be split at any byte.
- `toAiEvents(sseEvent)` maps LM Studio events to `AiEvent`:
  - `message.delta` → `{type:'delta', text}`;
  - `reasoning.delta` → `{type:'thinking', text}`;
  - `model_load.progress` → `{type:'status', stage:'loading', progress}`;
  - `prompt_processing.progress` → `{type:'status', stage:'reading', progress}`;
  - `error` → `{type:'error', error}`;
  - `chat.end` → `{type:'done', responseId, stats}`;
  - everything else is ignored.
- `friendlyError(error, status?, body?)`:
  - connection refused or timeout → "LM Studio's server isn't running. Start it in LM Studio (Developer → Start server) or run `lms server start`.";
  - 404 on `/api/v1` → "Update LM Studio to version 0.4 or newer.";
  - unknown model → "The model … isn't available in LM Studio.";
  - out of memory → "Not enough memory to load … at this context size. Lower 'Largest context' in Settings or choose a smaller model.";
  - an expired `previous_response_id` → the code `conversation_expired` (phase 10 then starts a new conversation);
  - anything else → the server's message, cut to 300 characters.
- `filterModels(raw)` keeps LLMs only (no embedding models) and maps them to `AiModel`.

**`ai.ts`:**
- `listModels()` → `{ reachable, url, error?, models: AiModel[] }`, from `GET {url}/api/v1/models` with a 1.5 s timeout.
- `chat(req, emit)`:
  - **Request:** `req` is `{ requestId, model, input, systemPrompt?, previousResponseId?, contextLength? }`.
  - **Body:** `POST {url}/api/v1/chat` with `{ model, input, system_prompt, previous_response_id, context_length, stream: true, store: true }`. Set `reasoning` from task 1's findings.
  - **Events:** emits `AiEvent`s and sends exactly one terminal event: `done`, `error`, or `done` with `cancelled: true`.
  - **Timeouts:**
    - none overall (a 26B model can be slow);
    - 120 s without any event before the first `message.delta` (this covers loading a model);
    - 60 s between events after that.
- If task 1 shows that `context_length` on `/chat` is ignored for a loaded model, `chat` first calls `/api/v1/models/load` (and unloads the smaller instance if that is needed and possible) whenever `contextLength` is set. It emits `status: loading` meanwhile.
- `cancel(requestId)` aborts through an `AbortController`. All of a window's requests are aborted when it closes or reloads.

### 4. IPC

Add to `src/shared/api.ts` (`IPC` and `Api`), `src/main/ipc.ts` (validate every argument as `unknown`, as the other handlers do), `src/preload/index.ts` and `src/preload/index.d.ts`:

| Channel | Shape |
|---|---|
| `ai:listModels` (invoke) | → `{ reachable, url, error?, models }` |
| `ai:chat` (invoke) | `AiChatRequest` → resolves when the stream ends |
| `ai:cancel` (send) | `{ requestId }` |
| `ai:event` (main → renderer, via `subscribe()`) | `{ requestId, …AiEvent }` |

These are exposed as `window.api.ai.{ listModels, chat, cancel, onEvent }`.

Limits: `model` 1–200 characters, `input` and `systemPrompt` up to 2 MB together, `contextLength` an integer from 2,048 to 262,144, and `previousResponseId` matching `^resp_[A-Za-z0-9_-]{1,200}$`.

### 5. Engine: document text

- New module `engine/pdfengine/plaintext.py`, with its route registered like the other document routes in `api.py`:
  `GET /v1/docs/{docId}/plain-text?from=0&to=<last>&maxChars=<n>` → `{ pages: [{ index, text }], pageCount, truncated }`.
- Build each page from `textpages.content_text_page(...)`, which is safe under the journal and at every rotation.
  - **Never** use `page.get_text()`: it breaks on rotated pages with the journal on (STATUS.md, Verified facts).
  - Take blocks and lines in reading order. Join lines with `\n` and blocks with a blank line. Leave out annotation text.
- Take `sessions.MUPDF_LOCK` per page, not for the whole request.
- Stop **at a page boundary** before `maxChars` would be exceeded, and set `truncated: true`. The first requested page is always included, cut to `maxChars` if necessary.
- Errors: an unknown document → the existing 404; `from`/`to` out of range → 400 `bad_request`.
- Renderer: `engine.plainText(docId, { from, to, maxChars })` in `src/renderer/src/api/engine.ts`.

### 6. Settings

Follow the four existing layers:
- `UserSettings` in `src/shared/api.ts`;
- `SettingsSchema`, `DEFAULTS` and `setUserSettings` in `src/main/settings.ts`, with validators in `src/main/settings-rules.ts`;
- `DEFAULT_SETTINGS` and `applyUserSettings` in `src/renderer/src/state/settings.ts`;
- the UI in `src/renderer/src/dialogs/PreferencesDialog.tsx`.

| Setting | Type | Default | Rule |
|---|---|---|---|
| `aiServerUrl` | string | `http://127.0.0.1:1234` | an http/https URL, trailing `/` removed |
| `aiModel` | string \| null | `null` | a model key, 1–200 characters |
| `aiContext` | `'page' \| 'document'` | `'page'` | – |
| `aiMaxContext` | number | `32768` | 4,096–131,072. The largest context the app asks for; it limits memory use in whole-document mode |

New **"AI assistant (LM Studio)"** section in the Settings dialog:
- the server address field with "Reset";
- a **Test connection** button showing "LM Studio: 3 models (gemma-4… loaded, 8,192 tokens)", or the friendly error;
- a model `<select>` filled by that test, marking which models are loaded;
- "Context sent to the model: This page / Whole document";
- "Largest context: 4K / 8K / 16K / 32K / 64K / 128K tokens", with the note "Larger lets more of a long document in, but uses more memory and makes LM Studio reload the model".

## Tests

- `src/shared/ai.test.ts`:
  - `chooseContextLength`: loaded and big enough, loaded but too small, not loaded, capped by the model's maximum and by `cap`, rounding;
  - `excerptCharBudget`;
  - `estimateTokens`.
- `src/main/ai-protocol.test.ts`:
  - `parseSse` with input split at every byte position;
  - `toAiEvents` for every event type, using **real payloads recorded in task 1** as fixtures;
  - every `friendlyError` case;
  - `filterModels`.
- `src/main/ai.test.ts` against a fake LM Studio (Node `http`, random port) that serves `/api/v1/models` and a streaming `/api/v1/chat`. Cover:
  - listing;
  - a streamed answer in order, with status events;
  - `context_length` and `previous_response_id` in the request body when given (and absent otherwise);
  - cancel mid-stream (one terminal event, server sees the connection close);
  - an unreachable port (`reachable: false` within the timeout);
  - a 404 on `/api/v1`;
  - an `error` event mid-stream.

  Keep `electron` out of the tested code: inject the event sender, and do the IPC wiring in `ipc.ts`.
- `src/main/settings-rules.test.ts`: the new validators.
- Engine `engine/tests/test_plaintext.py`:
  - known text at 0/90/180/270;
  - an edited (journalled) document;
  - annotation text left out;
  - `maxChars` stops at a page boundary and sets `truncated`;
  - a page range;
  - 404 and 400.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:engine`.
- With LM Studio's server running and gemma-4:
  - Test connection lists the model with its loaded state and context.
  - From DevTools in `pnpm dev`, `window.api.ai.chat` with a short prompt streams deltas on `onEvent`.
  - A second call with the returned `previousResponseId` continues the conversation.
  - A call with `contextLength` larger than the loaded size gives the behaviour recorded in task 1 (reload, with `status: loading` events).
  - `cancel` stops generation (LM Studio's log).
- Stop the server: Test connection shows the friendly "isn't running" message within about 2 s.
- `engine.plainText` on a long PDF with a small `maxChars` cuts at a page boundary.

## Done when

- Task 1's findings are recorded under "Verified facts" (and the plans are adjusted if needed).
- Listing, streaming, conversation continuation, context sizing and cancel work against the installed LM Studio.
- Settings persist and are validated.
- The plain-text endpoint works at every rotation and under the journal.
- All tests pass.
