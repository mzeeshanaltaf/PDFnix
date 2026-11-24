# Phase 10 — AI Assistant Panel and Menu Actions

**Goal:** the AI assistant the user sees. This phase connects phase 8's menu to phase 9's LM Studio backend.

- An **AI Assistant** side panel with a chat, a model picker, a "This page / Whole document" switch, and progress while LM Studio loads the model or reads the document.
- **Simplify**, **Define** and **Ask AI Assistant** in the selection menu.

**Depends on:** phase 8 (the selection menu and its extension point) and phase 9 (`window.api.ai`, `src/shared/ai.ts`, `engine.plainText`, AI settings, and the LM Studio facts under "Verified facts" in STATUS.md).

## Background

The user's decisions are in phase 8's plan. Phase 9 explains why only LM Studio is supported. What matters here:

- Answers go to a **side-panel chat**, not inline.
- Simplify sends exactly `Simplify <selected text>`. Define sends exactly `Define <selected text>`.
- The context is the **current page** by default, with a **whole-document** option.
- LM Studio's `/api/v1/chat` takes `input` + `system_prompt`. Follow-up questions continue with `previous_response_id`, not a messages array.

**Before starting**, read phase 9's "Verified facts" entries. If they changed how `previous_response_id` or `context_length` behave, follow them over this document and note it under "Deviations and decisions".

## Scope

Included:
- the assistant store per tab;
- the side panel;
- markdown answers;
- progress and thinking states;
- the three menu actions;
- a command and shortcut to open the panel.

Not included:
- keeping chats after the app closes;
- inline answers;
- jumping from an answer to a page;
- sending page images to vision models;
- Ollama or other servers.

Pages without a text layer give no context; the panel says so.

## Tasks

### 1. Assistant state: `src/renderer/src/state/assistant.ts`

A zustand store keyed by tab id. It lives in memory only. Drop a tab's entry when the tab closes, in the same place other per-tab state is cleared.

**Per tab:**
- `items`: the visible transcript, one of:
  - `{ kind: 'user', action: 'simplify'|'define'|'ask', question?, selection?, page }`;
  - `{ kind: 'assistant', text, thinking, status?, error?, cancelled? }`, where `status` is `{ stage: 'loading'|'reading', progress }`;
  - `{ kind: 'divider', label }`, e.g. "New conversation · Whole document · gemma-4".
- `conversation`: `{ responseId, model, contextMode, contextLength, revision } | null`. The server-side thread that follow-up questions continue. `contextLength` is the size the conversation started with (phase 9: LM Studio answers with the loaded instance of exactly the requested size, so sending it again keeps follow-ups on the same instance when several copies are loaded).
- `streaming`, `requestId`.
- `contextMode`, starting from the `aiContext` setting.
- `contextNote`, e.g. "Pages 1–12 of 40 included" or "This page has no text".
- `pendingQuote`: the selection waiting on the input as a chip.

**Shared state:** `server` (the last `ai:listModels` result), `loadingModels`, `refreshModels()`.

**`askAssistant(tabId, { action, selection, page, question? })`:**

1. **Model.** Use the `aiModel` setting. If it is unset or no longer listed, take the first loaded model, else the first model, and save it back. With no models, show the empty state (task 2) and stop.

2. **The user's text** (pure `userPrompt`):
   - `simplify` → `Simplify ${selection}`
   - `define` → `Define ${selection}`
   - `ask` → `${question}`, followed by `\n\nSelected text:\n"""\n${selection}\n"""` when there is a selection

3. **Continue or start a conversation.** Continue (send `previousResponseId` and the conversation's `contextLength`, no system prompt, no new excerpt) only when all of these hold:
   - `conversation` exists;
   - its model and context mode are the current ones;
   - for page mode, the page is the same;
   - its revision equals the document's current revision.

   Otherwise start a new one, and add a divider if there were earlier items.

4. **Starting a conversation: build the context.** This step uses `src/shared/ai.ts`.
   - Model info comes from `server.models`.
   - `contextTokens` = `min(maxContext ?? cap, cap)`, where `cap` is the `aiMaxContext` setting. In page mode it is the loaded context when that is enough for the page.
   - The page's or document's text comes from `engine.plainText`:
     - in page mode, the selection's page, or the tab's current page when there is no selection;
     - in document mode, `0..pageCount-1`;
     - `maxChars` is `excerptCharBudget(...)`.
   - When `truncated`, set `contextNote` from the pages returned.
   - The system prompt is built by the pure `systemPrompt(excerpt, fileName, pagesLabel)`. It says:
     - you are the assistant in PDFnix, a PDF reader;
     - answer from the document excerpt below when it is relevant;
     - answer in the language of the user's request;
     - be concise;
     - use markdown;
     - say so when the excerpt doesn't contain the answer.

     The excerpt follows, labelled with its 1-based page numbers.
   - `contextLength` = `chooseContextLength({ neededTokens: estimate(system + input) + ANSWER_RESERVE, loadedContext, maxContext, cap })`. It always returns a number: the loaded size when that is enough (nothing reloads), else a new size (phase 9's client then unloads the model's smaller instances and LM Studio loads it at that size).
   - `reasoning`: send `'off'` when the model's `reasoningOptions` include it (phase 9: gemma-4 with reasoning on spent 37 s and 1,628 tokens thinking before a five-word answer); otherwise leave it out.

5. **Send** with `ai.chat`, then handle the events:
   - `status`: shown as "Loading gemma-4… 40%" / "Reading the document… 70%";
   - `thinking`: shows "Thinking…" (the reasoning text is not shown);
   - `delta`: appends to the answer;
   - `done`: stores `responseId` in `conversation`;
   - `error`: shows the friendly text. On `conversation_expired` (the stored response is gone: LM Studio deletes them after 30 days; a server restart keeps them), clear `conversation` and retry once as a new conversation, with a divider. Do the same on `stream_ended` in a continued conversation: LM Studio ends the stream without a word when the conversation has outgrown the context.

6. Asking while an answer is still streaming cancels that answer first.

**Other functions:**
- `stopAssistant(tabId)` (`ai.cancel`).
- `clearAssistant(tabId)`: clears the items and `conversation`.
- `setContextMode(tabId, mode)`: also saves `aiContext`. The next question starts a new conversation.
- `setModel(key)`: saves `aiModel`. The next question in every tab starts a new conversation.

### 2. Panel: `src/renderer/src/panels/Assistant.tsx`

**Register the panel:**
- Add `'assistant'` to `SidePanelId` (`src/renderer/src/state/tabs.ts`).
- In `src/renderer/src/shell/SidePanel.tsx`, add `{ id: 'assistant', label: 'AI Assistant', icon: Sparkles }` to `PANELS` and a case to `PanelBody`.
- The panel `<section>` is `w-96` for this panel; the others stay `w-60`.
- Check `viewer/codeScan.ts` (it reads which panel is open) still behaves.

**Header:**
- A model picker (`dropdown-menu`): LM Studio's chat models. Loaded ones are marked with a dot and their context ("8K"), unloaded ones show "loads on first use".
- Refresh.
- A "This page / Whole document" toggle.
- Clear chat.
- `contextNote` as a muted line under the header.

**Messages:** a scrolling list that stays at the bottom while an answer streams, unless the user has scrolled up.
- A user item shows the action ("Simplify", "Define", or the question) and the selection as a quote cut to 3 lines, with "Show more".
- An assistant item:
  - Shows the progress line or "Thinking…" until text arrives.
  - The answer is rendered as markdown with **`react-markdown` + `remark-gfm`**. These are new dependencies; add them to `package.json`. Keep the default of no raw HTML. Links go through the existing confirmation (`viewer/openLink.ts`) instead of navigating.
  - **Copy** (`copyText`), and **Stop** while streaming.
  - Errors show phase 9's friendly text, with a **Retry** button that resends the last user message.
- Dividers are a thin rule with their label.

**Input:**
- A native `<textarea>` (there is no shadcn textarea) that grows to 6 lines.
- Enter sends, Shift+Enter starts a new line. While an answer streams, the send button becomes Stop.
- A `pendingQuote` shows as a removable chip above the textarea.
- The page's single-letter shortcuts must not fire while typing. Check how `shell/shortcuts.ts` treats a focused textarea.

**Empty states:**
- **Server not reachable:**
  - "LM Studio's server isn't running. Open LM Studio and start it (Developer → Start server), or run `lms server start`. To have it always available, turn on LM Studio's option to start the server at login."
  - **Retry** and **Settings** buttons.
- **Server older than 0.4:** "Update LM Studio to version 0.4 or newer."
- **No chat models:** "Download a model in LM Studio (Discover tab), then press Refresh."
- **No text on the context pages:** "This page has no text. Run Tools → Recognise Text (OCR) first."

### 3. Menu actions

Register a section through phase 8's extension point, from a module `App.tsx` imports (e.g. `src/renderer/src/tools/assistantMenu.ts`): `registerSelectionMenuSection({ id: 'assistant', label: 'AI Assistant', items, note })` from `tools/selectionMenuState.ts`. Each item is `{ id, label, icon, run(context) }`; `context` is `{ tabId, text, page, pieces }`. `note` is drawn as the muted footnote below the items.

| Item | Icon (lucide) | Runs |
|---|---|---|
| Simplify | `ListCollapse` | `setSidePanel(tabId, true, 'assistant')`, then `askAssistant(tabId, { action: 'simplify', selection: text, page })` |
| Define | `BookOpenText` | The same with `'define'` |
| Ask AI Assistant | `Sparkles` | Opens the panel, sets `pendingQuote` to `{ text, page }`, and focuses the input through a window event (like `FOCUS_SEARCH_EVENT` for Find) |

- The selection text and page come from the menu's context, which phase 8 captures before the menu closes.
- Under the items, add a one-line muted footnote (the section's `note`): "Runs on this computer with LM Studio".

### 4. Command and shortcut

- New command `view.assistant`: opens the AI Assistant panel, or closes it if it's open.
- Shortcut **Ctrl+Shift+A**, which is free. Check `shortcutFor` again first.
- Add it to:
  - `MENU_COMMANDS` (`src/shared/api.ts`);
  - the View menu in `src/main/menu.ts` ("AI Assistant"; the accelerator is shown but not registered, like the others);
  - `runCommand` in `shell/commands.ts`;
  - `shell/shortcuts.ts`;
  - `shell/shortcutReference.ts`.

### 5. Licences and docs

- Run `pnpm notices` so `resources/licenses/THIRD-PARTY-NOTICES.txt` includes react-markdown, remark-gfm and their dependencies.
- Add an "AI assistant" section to the README, and to the user guide if one exists under `docs/`. Cover:
  - it needs LM Studio 0.4 or newer with its server running;
  - nothing leaves the computer unless the server address points at another machine;
  - choosing a model and the context;
  - "Largest context" and memory use.

## Tests

**Renderer (vitest):**
- `userPrompt`: the exact `Simplify …` and `Define …` texts; Ask with and without a selection.
- `systemPrompt`: the page label, the truncation note, empty text.
- The continue-or-new rule: same model, mode, page and revision continues; any change starts a new conversation and adds a divider.
- The store, with `window.api.ai` and `engine.plainText` mocked:
  - deltas accumulate;
  - status and thinking states;
  - `responseId` is stored and sent as `previousResponseId` on the follow-up, with no system prompt;
  - `conversation_expired` (and `stream_ended` in a continued conversation) retries once as a new conversation;
  - error;
  - cancel;
  - a new question cancels the running one;
  - document mode passes the budget, and `contextLength` comes from `chooseContextLength`.
- The `shortcutReference` test covers Ctrl+Shift+A.

**End-to-end (new `tests/e2e/assistant.spec.ts`):**

Start a fake LM Studio with Node `http` on a random port. It serves `/api/v1/models` and a streaming `/api/v1/chat`, built from the payloads phase 9 recorded, and records each request. Point `aiServerUrl` at it.

- Select text, then **Simplify** from the menu: the panel opens, the progress line and then the streamed answer appear, and the recorded request has `input` exactly `Simplify <selected text>` and the page's text in `system_prompt`.
- **Define**: the same check.
- **Ask AI Assistant**: the input is focused and shows the quote chip. Type a question and press Enter. The request has the question and the quoted selection. A follow-up sends `previous_response_id` and no `system_prompt`.
- **Whole document** on a multi-page fixture: `system_prompt` contains text from the last page, and `context_length` is set when the fake model's loaded context is too small.
- **Stop** during a slow fake stream: the message is marked stopped, and the fake server sees the connection close.
- **Server unreachable**: the empty state appears.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:engine`, `pnpm build && pnpm test:e2e`.
- By hand in `pnpm dev` with LM Studio and gemma-4:
  - each menu action on English text, and on a non-English PDF (e.g. a Swedish letter like the one in the original request) to check the answer's language;
  - a follow-up question;
  - switching the model mid-chat (divider, new conversation);
  - Whole document on a long PDF ("Pages … included", the loading progress when LM Studio reloads at a larger size);
  - Stop;
  - stopping the server mid-answer (friendly error) and Retry after restarting it;
  - restarting LM Studio between two questions (an expired conversation recovers);
  - light and dark theme;
  - Ctrl+Shift+A.
- `pnpm dist:dir` and `pnpm test:e2e:packaged`, to check that the packaged app still starts. Tag the assistant spec `@smoke` if its fake server works in the packaged project.

## Done when

- The three actions and free questions work against LM Studio.
- Page and whole-document context, follow-ups, Stop and error recovery work.
- All tests pass.
- STATUS.md records the pinned versions (react-markdown, remark-gfm), a Deviations entry for phases 8–10, and any open known issues.

Then offer the user a **v0.4.0** release, as for 0.2.0 and 0.3.0: bump `package.json`, `engine/pyproject.toml`, `engine/pdfengine/__init__.py` and `uv.lock`, run `pnpm dist`, and publish a GitHub release. Do not release without being asked.
