# Project Status

Single source of truth for where the project stands. Read fully at the start of every session; update during and at the end of every session. The protocol is in `CLAUDE.md` at the project root.

**Last updated:** 2026-11-13 — phase 2 session (phase 2 complete, committed and pushed; README added)

## Phases

| # | Phase | Plan | Status | Started | Completed |
|---|---|---|---|---|---|
| 1 | Foundation | [phase-1-foundation.md](phase-1-foundation.md) | Complete | 2026-11-12 | 2026-11-12 |
| 2 | Viewer | [phase-2-viewer.md](phase-2-viewer.md) | Complete | 2026-11-13 | 2026-11-13 |
| 3 | Annotations and save | [phase-3-annotations-and-save.md](phase-3-annotations-and-save.md) | Not started | – | – |
| 4 | Content editing and signatures | [phase-4-content-editing-and-signatures.md](phase-4-content-editing-and-signatures.md) | Not started | – | – |
| 5 | Document tools | [phase-5-document-tools.md](phase-5-document-tools.md) | Not started | – | – |
| 6 | Processing jobs | [phase-6-processing-jobs.md](phase-6-processing-jobs.md) | Not started | – | – |
| 7 | Packaging and release | [phase-7-packaging-and-release.md](phase-7-packaging-and-release.md) | Not started | – | – |

Status values: Not started · In progress · Complete · Complete with accepted exceptions.

## Current position

- **Current phase:** 3 — Annotations and save (not started)
- **Next action:** in a new session, follow the start-of-session steps in `CLAUDE.md`, then begin phase 3 from [phase-3-annotations-and-save.md](phase-3-annotations-and-save.md), starting with its journalling spike. Read the phase 2 handoff note and the "Carried over" rows targeted at phase 3 first.
- **Uncommitted work:** none. Phases 1 and 2 are committed on `main` and pushed to `origin` (https://github.com/mzeeshanaltaf/PDFnix.git); the user asked for the phase 2 push. Ask before pushing later phases unless told otherwise.

## Current phase progress

Checklist for the phase in progress. The session that starts a phase writes this list from the phase plan, ticks items as they are finished, and clears it when the phase completes (the summary then goes into the handoff note).

- [ ] (to be written when phase 3 starts)

## Commands

How to run and test the project. Run from the project root.

| Purpose | Command |
|---|---|
| Run the app in development | `pnpm dev` |
| Lint (ESLint for the app, ruff for the engine) | `pnpm lint` |
| Type-check | `pnpm typecheck` |
| App tests (vitest: main helpers and renderer) | `pnpm test` |
| Engine tests (pytest) | `pnpm test:engine` |
| Format (Prettier + ruff format) | `pnpm format` |
| Production build of the app code (no installer) | `pnpm build` |
| End-to-end tests | (phase 7) |
| Build installer | (phase 7) |

Notes for whoever runs these:

- **From Claude Code inside VS Code, clear `ELECTRON_RUN_AS_NODE` first** (`Remove-Item Env:ELECTRON_RUN_AS_NODE`). That shell inherits `ELECTRON_RUN_AS_NODE=1` from the editor, which makes Electron start as plain Node and fail with `Cannot read properties of undefined (reading 'isPackaged')`. A normal terminal is not affected.
- To inspect the running app from a script, use `pnpm exec electron-vite dev --remoteDebuggingPort 9222` and talk to it over the DevTools protocol. `electron-vite preview` does not accept that flag; to run the built app with it, run `pnpm build` and then `node_modules\electron\dist\electron.exe . --remote-debugging-port=9222`.
- This machine runs other projects' Python and `uv` processes. When checking for or killing leftover engine processes, match on `-m pdfengine` in the command line; never act on `python.exe` by name alone.
- Development uses its own settings folder, `%APPDATA%\PDFnix-dev` (the installed app will use `%APPDATA%\PDFnix`).

## Environment

Recorded on 2026-11-12 on the development machine:

- Windows 11 Pro, PowerShell
- Node 24.12.0, npm 11.6.2, pnpm 10.5.2
- Python 3.12.7 (`python`; the `py` launcher is not available), uv 0.8.3
- git 2.47.0
- Remote: `origin` = https://github.com/mzeeshanaltaf/PDFnix.git, branch `main` (the user asked for phase 1 to be pushed there; ask before pushing later phases unless told otherwise)

## Pinned versions

Versions are locked by `pnpm-lock.yaml` and `engine/uv.lock`. The ones that matter:

| Package | Version | Why it matters |
|---|---|---|
| electron | 44.11.2 | Runtime (45 exists; not adopted) |
| electron-vite / vite | 6.0.0 / 8.3.8 | Build tooling; config options below depend on electron-vite 6 |
| react / react-dom | 19.3.1 | UI |
| typescript | 5.9.3 | 7.0.2 exists; staying on the version the template and tooling target |
| tailwindcss / @tailwindcss/vite | 4.3.5 | Styling (v4, CSS-first config; there is no `tailwind.config`) |
| shadcn CLI / radix-ui / cn | 4.23.0 / 1.8.1 / 0.5.2 | Generated UI components import from the `radix-ui` and `cn` packages |
| zustand | 5.1.0 | Renderer state |
| electron-store | 12.0.0 | Settings; ESM-only, so it is bundled into the main build |
| vitest | 5.1.0 | App tests |
| eslint | 9.39.5 | npm marks 9.x deprecated in favour of 10; the template's config targets 9 |
| pymupdf | 2.1 (MuPDF 1.28.6) | All PDF work. A major version beyond the 1.x line; brings extra dependencies (see Deviations) |
| fastapi / uvicorn | 0.162.5 / 0.54.0 | Engine HTTP server |
| pytest / httpx / ruff | 9.2.0 / 0.28.1 / 0.17.4 | Engine dev tools |

## Verified facts

Answers to the "confirm against the pinned version" notes in the plans, so they are checked once.

| Question | Answer | Phase | Date |
|---|---|---|---|
| Are the pinned `pdf2docx` and PyMuPDF versions compatible? | Yes for `pdf2docx` 0.5.13 with PyMuPDF 2.1: no resolver conflict, and a two-page test PDF converted correctly (text of both pages present in the .docx). Tested in a throwaway environment; `pdf2docx` is not yet a project dependency. It imports the legacy `fitz` name, which PyMuPDF 2.1 flags as deprecated, so re-test on any PyMuPDF upgrade | 6 | 2026-11-12 |
| How is PyMuPDF imported and how are its versions read? | `import pymupdf` (not `fitz`; the old name still works but warns). `pymupdf.__version__` is `"2.1"`, `pymupdf.mupdf_version` is `"1.28.6"`. Where later plans write `fitz.…`, use `pymupdf.…` | all | 2026-11-12 |
| Does PyMuPDF journalling cover all edit types for undo/redo? | Open — spike at the start of phase 3 | 3 | |
| Is `Document.rewrite_images` available, and with which parameters? | Open | 6 | |
| Exact `apply_redactions` options and `insert_htmlbox` parameters | Open | 4 | |
| OCR API (`get_textpage_ocr`) arguments and tessdata location handling | Open | 6 | |
| Can a sandboxed preload import from `node_modules`? | No. The preload imports only `electron` and `src/shared`; `preload.build.externalizeDeps` is `false` so everything else is bundled in | 1 | 2026-11-12 |
| Does the CSP from the plan work with Vite's dev server and with `file://`? | Yes, both. No violations in the console in development or in the built app | 1 | 2026-11-12 |
| What origin does the built app's page send to the engine? | `null` (page loaded from `file://`). Main passes that to the engine as the allowed CORS origin; in development it passes the dev-server origin | 1, 7 | 2026-11-12 |
| Can PyMuPDF 2.1 encode page images as WebP? | No. `Pixmap.tobytes` accepts png, pnm/pgm/ppm/pbm/pam, tga, psd, ps, jpg/jpeg only; WebP would need Pillow (not installed). `tobytes("jpeg", jpg_quality=…)` works | 2 | 2026-11-13 |
| In which space are text and search coordinates? | `get_text("words"/"dict"/"rawdict")` and `search_for` return **unrotated** coordinates; `page.rect` and rendered pixmaps are in the **rotated** (displayed) space. Multiply by `page.rotation_matrix` to convert (done in `text.py`). A line's `dir` is unrotated too | 2 (all later) | 2026-11-13 |
| Does `page.set_rotation` take effect on an open document? | Yes, immediately: `page.rect`, renders and the rotation matrices reflect it without reloading the page | 2 | 2026-11-13 |
| Password handling | `doc.needs_pass` is truthy for protected files and stays truthy after `authenticate`; `doc.is_encrypted` becomes False after it. `authenticate` returns 0 for a wrong password, 2 for the user and 4 for the owner password. `metadata["encryption"]` names the method, e.g. "Standard V5 R6 256-bit AES" | 2, 3, 6 | 2026-11-13 |
| Does rendering in two threads run in parallel? | No: two documents rendered in two threads took as long as rendering them one after the other (MuPDF holds the GIL). The engine therefore uses one process-wide lock for PyMuPDF | 2 | 2026-11-13 |
| Outline entries that point outside the document | `get_toc()` gives page `-1`; the API turns that into `page: null` | 2 | 2026-11-13 |
| Bad input to `pymupdf.open(stream=…)` | Empty bytes raise `pymupdf.EmptyFileError`, non-PDF bytes raise `pymupdf.FileDataError` | 2 | 2026-11-13 |

## Deviations and decisions

Anything that differs from the plan documents, or a decision the plans left open. Newest first. If an entry changes a later phase, that phase's plan document is edited too and the entry says so.

| Date | Phase | Decision or deviation | Reason | Plans updated |
|---|---|---|---|---|
| 2026-11-13 | 2 | **Pages are 0-based indexes everywhere in the API** (`/pages/{index}/…`, `page` in outline, search and rotate). The UI shows them 1-based | The plan did not say; 0-based matches PyMuPDF and array indexes | – |
| 2026-11-13 | 2 | Render takes `format=auto\|png\|jpeg` (default `auto`), not `webp`. `auto` sends PNG, or JPEG (quality 90) when images cover ≥ 60 % of the page. The ETag is `"revision-index-scale-format"`; responses carry `Cache-Control: no-store` because the renderer keeps its own cache | PyMuPDF 2.1 cannot write WebP (see Verified facts). PNG is lossless and small for text; scans are 2–3× smaller as JPEG | – |
| 2026-11-13 | 2 | Search returns `{ hits: [{ page, quads, before, match, after }], truncated }` (stops at 5,000 hits) instead of `[{ page, quads, snippet }]`, and matches against the page's characters itself rather than calling `page.search_for` | `search_for` cannot match case or whole words. Own matching also joins a phrase across a line break (one hit, one quad per line) and gives the exact matched text for the snippet. A search is cancelled when the client disconnects | – |
| 2026-11-13 | 2 | The text endpoint also returns each line's `angle` (0/90/180/270, displayed space) | The text layer needs it to lay out rotated text | – |
| 2026-11-13 | 2 | One process-wide lock (`sessions.MUPDF_LOCK`) instead of one lock per session; at most two renders wait for it at once, and a render whose client has gone is dropped before it starts | MuPDF is not thread-safe across documents either, and threads do not run in parallel (see Verified facts). Dropping abandoned renders keeps fast scrolling responsive | – |
| 2026-11-13 | 2 | Added `DELETE /v1/docs` (close every session) | A renderer reload (F5) loses its tabs; the fresh page closes whatever the engine still holds | – |
| 2026-11-13 | 2 | Rotate returns the mutation response plus `pages: [{ index, width, height, rotation }]`. A multiple of 360° changes nothing and does not bump the revision. Rotation is not undoable or saveable yet | As the plan says; phase 3 moves it into the edit pipeline | – |
| 2026-11-13 | 2 | Error codes added: `file_not_found` (404), `file_unreadable` (403), `invalid_pdf` (422), `bad_request` (400), plus the planned `password_required` / `password_incorrect` (401) | Distinct, user-explainable failures when opening | – |
| 2026-11-13 | 2 | New engine modules beyond the plan: `api.py` (the document routes) and `info.py` (outline and properties) | Keeps `server.py` to app setup and each module to one area | – |
| 2026-11-13 | 2 | Menu accelerators are shown but not registered (`registerAccelerator: false`); the renderer handles every shortcut in `shell/shortcuts.ts`. Menu clicks send a `menu:command` to the renderer, which runs the same `runCommand` as the toolbar. Cut/Copy/Paste/Select All use Electron roles | One place for keys, so a key press never runs twice and shortcuts can respect focus (arrows in a text box stay with the text box) | – |
| 2026-11-13 | 2 | Extra shortcuts: Ctrl+1 fit width, Ctrl+2 fit page, Ctrl+D properties, Ctrl+G / Ctrl+Shift+G find next/previous, Ctrl+PageUp/PageDown switch tabs, F4 side panel, arrows/PageUp/PageDown/Space/Home/End to move | Common reader conventions | – |
| 2026-11-13 | 2 | Find is a side panel (rail button and Ctrl+F), not a separate bar. The side panel's open state and choice are per tab. The Outline rail button is hidden for documents without an outline. Outline shows top-level entries collapsed | The plan put Search under `panels/`; per-tab panels are in the plan's per-tab state | – |
| 2026-11-13 | 2 | A tab has its own `id`, separate from the engine `docId`. After an engine restart every tab reopens its file from disk (with the remembered password) and keeps its page, zoom and layout; changes not saved (rotations) are lost with a warning | The engine forgets its sessions when it dies; phase 3's recovery copies will make this lossless | Carried over (phase 3) |
| 2026-11-13 | 2 | Opening goes through `state/documents.ts` `openPath`. Main sends paths (dialog, recent, command line, second launch) to the renderer, queueing them until the renderer calls `files.takePending()`; dropped files are resolved with `webUtils.getPathForFile` in the preload | One path into the engine; main does no PDF work | – |
| 2026-11-13 | 2 | `hasTextLayer` looks at the first 50 pages only | Opening stays fast on very long documents | – |
| 2026-11-13 | 2 | New renderer layout: `viewer/` (geometry, layout, zoom, pageImages, pageText, hooks, textLayout, selection, controller, viewPositions, PageList, PageView, TextLayer), `panels/` (VirtualList, Thumbnails, Outline, Search + pure helpers), `dialogs/` (Password, Properties — `dialogs/` arrives before phase 5), `state/` (documents, dialogs, recent), `shell/` (commands, shortcuts, ToolbarFields); main gets `files.ts` and `file-paths.ts`. `geometry.ts` re-exports `lib/units.ts` | Plan named only the main components | – |
| 2026-11-12 | 1 | PyMuPDF resolved to **2.1**, not a 1.x release. It hard-depends on `pymupdf-layout`, `pymupdf4llm`, `onnxruntime`, `numpy`, `networkx`, `psutil`, `pyyaml`, `tabulate` | Latest release at the time; nothing in the plans requires 1.x. The extras are unused by the engine but will inflate the frozen build unless excluded | Phase 7 (freeze step) |
| 2026-11-12 | 1 | The engine watches the PID passed in `PDFENGINE_PARENT_PID`, not its direct parent | In development the direct parent is `uv` and then the venv's `python.exe` launcher, so `os.getppid()` would watch the wrong process | Phase 1 conventions, phase 7 |
| 2026-11-12 | 1 | CORS: main passes the renderer origin in `PDFENGINE_ALLOWED_ORIGINS`; preflight requests are answered without a token | The renderer calls the engine cross-origin with a custom header, which the browser preflights. The plan did not cover CORS | Phase 1 conventions |
| 2026-11-12 | 1 | A new token is generated for every engine launch, including restarts; the port also changes | Simplest reading of "generated by main per launch". The renderer re-reads the connection after each restart (`resetConnection`) | – |
| 2026-11-12 | 1 | "Restart once": one automatic restart after an unexpected exit. A second crash within 60 s of the restarted engine becoming ready stops the retries and shows a dialog (Try Again / Continue Without Engine / Quit). An engine that ran for 60 s earns a fresh automatic restart | The plan said "restart once" without defining when the allowance renews | – |
| 2026-11-12 | 1 | Theme is driven by `prefers-color-scheme` via `nativeTheme.themeSource`; there is no `.dark` class and no `next-themes` | Correct colours before any script runs, so no flash, and one source of truth. Tailwind's `dark:` variant uses the same media query, so shadcn components work unchanged | Phase 1 conventions |
| 2026-11-12 | 1 | Class merging uses the `cn` npm package; components import primitives from the `radix-ui` umbrella package. No `lib/utils.ts` | This is what shadcn CLI 4.23 generates. `cn` is shadcn's own package (checked: maintainer and repository are shadcn's) | Phase 1 conventions |
| 2026-11-12 | 1 | Added beyond the planned layout: `src/shared/api.ts`, `src/main/{engine-protocol,theme,settings}.ts`, `src/renderer/src/{shell/,lib/units.ts,state/engine.ts}`, `engine/pdfengine/watchdog.py`, `engine/tests/test_engine_process.py` | Shared types between processes; testable pure helpers; the status indicator needs state | Phase 1 layout |
| 2026-11-12 | 1 | Removed the template's `@electron-toolkit/utils` and `@electron-toolkit/preload` | The preload must not expose anything generic, and the few helpers used were one-liners | – |
| 2026-11-12 | 1 | Development uses the user-data folder `PDFnix-dev` | Keeps dev settings and the single-instance lock separate from an installed copy | – |
| 2026-11-12 | 1 | `pnpm lint` runs ruff as well as ESLint; generated shadcn files in `components/ui` are excluded from ESLint and Prettier | One command checks both halves; generated files stay as generated so CLI updates are clean | – |
| 2026-11-12 | 1 | In the application menu, View → Theme, Help → About and File → Exit work; every other entry is a disabled placeholder | Those three are implemented in phase 1; the plan says entries are disabled "until later phases implement them" | – |
| 2026-11-12 | 1 | `/v1/health` also returns `mupdfVersion`, `pythonVersion` and `openDocuments` | Useful in the status tooltip and for diagnostics | – |
| 2026-11-12 | 1 | The scaffold was generated in a temporary folder and copied in, without the template's README, macOS files and demo assets | The generator is interactive and the project root was not empty | – |
| 2026-11-12 | Planning | Pages are rendered by the Python engine, not pdf.js | One renderer, so the screen always matches the saved file | Already reflected in all plans |
| 2026-11-12 | Planning | Product name is **PDFnix**; `appId` is `com.pdfnix.app` | Name chosen by the user (replacing an earlier choice, "PDF Forge"). Use it for the window title, `productName`, installer and About dialog from phase 1 onward. Not checked against existing products or trademarks; do so before any public distribution | Phases 1 and 7 |

## Known issues

Bugs and limitations that exist in the code right now.

| Issue | Found in phase | Severity | Notes |
|---|---|---|---|
| One unexplained clean exit of the app in development | 1 | Unconfirmed | On the first of five launches the app exited with code 0 a few seconds after starting, with nothing in the log. The only code paths that quit are a closed window, the failure dialog's Quit button and a failed single-instance lock, so the window was most likely closed by hand. Not reproduced in four later runs covering reloads, hot updates and engine restarts. Watch for it |
| Editing a store module while the app runs can leave the status indicator stale | 1 | Low, development only | Hot reload swaps `state/engine.ts` for a fresh store while the old monitor keeps the subscription. Press F5 in the app |
| "No flash on start" was checked by state, not by eye | 1 | Low | Confirmed: the saved theme is applied before the window is created, the window's background colour equals the page's, and with the OS in dark mode the app restarted in its saved light theme. Not confirmed frame by frame |
| App icons are the electron-vite template's | 1 | Low | Replaced in phase 7 |
| pytest prints a Starlette deprecation warning about `httpx` | 1 | Low | "Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead." Tests pass. Revisit when Starlette drops support |
| Renderer bundle is 1.1 MB (958 kB after phase 1) | 1 | Low | Mostly the `radix-ui` umbrella package. Irrelevant for a local app; look at it in phase 7's performance pass |
| Rotations are lost when the engine restarts or the tab is closed | 2 | Expected until phase 3 | They live only in the engine's working copy. After an engine restart the documents are reopened from disk and a toast says unsaved changes were lost |
| At high zoom very large pages are slightly soft | 2 | Low, by design | A page image is capped at 40 MP (plan). E.g. A3 landscape at 800 % is drawn from a 7,522 px wide image stretched to 12,704 CSS px. A4 at 800 % on a 1× display is just over the cap too. Tiled rendering would remove this |
| The selection highlight shows hairline seams between some words | 2 | Cosmetic | Each word is its own span stretched to the next word; sub-pixel rounding leaves thin gaps or overlaps. Copy is unaffected |
| Two checks were done by script, not by eye or hand | 2 | Low | The native File → Open Recent submenu (built from the same list the empty state shows, which was checked) and Ctrl+C through the Electron menu's Copy role (the copy itself was checked with `document.execCommand('copy')`, which raises the same `copy` event) |
| In development the first document opened after `pnpm dev` can make Vite optimise a dependency and reload the page | 2 | Low, development only | Seen once (`class-variance-authority`). The reload closes the tabs; open the file again |

## Carried over

Work or ideas deferred to a later phase, and questions waiting for the user.

| Item | Target phase | Notes |
|---|---|---|
| Enable toolbar buttons and menu entries as features arrive | 3–6 | Save, Print, Undo, Redo and the tools are `disabled` in `shell/Toolbar.tsx`; `menu.ts` uses `placeholder(...)` for entries not yet implemented. New menu commands: add the id to `MENU_COMMANDS` in `src/shared/api.ts`, handle it in `shell/commands.ts`, give it a key in `shell/shortcuts.ts` |
| Comments side panel | 3 | `shell/SidePanel.tsx` shows placeholder text for the `annotations` panel |
| Rotation through the edit pipeline | 3 | `pages.rotate_pages` calls `Session.mutated`; wrap it in a journal operation. The renderer turns search hits on rotated pages itself (`rotatePages` in `state/documents.ts`); after an undo or redo of a rotation, re-run the search (or clear it) instead |
| Reopen after an engine restart without losing changes | 3 | `reopenAll` in `state/documents.ts` reopens from disk; use the recovery copy when there is one |
| Opening a file that is already open is matched by path | 3 | `findTabByPath` in `state/tabs.ts`. After Save As, update the tab's `filePath`/`fileName` from the engine's answer so this stays right |
| Tiled rendering for very high zoom | later | Only if the softness at 800 % on large pages (Known issues) bothers anyone |
| Exclude PyMuPDF 2.1's unused dependencies from the frozen engine and re-measure size | 7 | Noted in the phase 7 plan |
| Show engine and PyMuPDF versions in the About dialog | 7 | The dialog currently shows app, Electron, Chromium and Node versions; the status-bar tooltip already shows the engine's |

## Phase handoff notes

One note per completed phase, added by the session that completes it. Use this template:

```
### Phase n — <title> (completed YYYY-MM-DD)

**Built:** what now exists, in a few lines.
**Key files:** the entry points a newcomer should read first.
**Verification results:** what was run and the outcome; anything not run and why.
**Accepted exceptions:** items from "Done when" the user agreed to skip, if any.
**Things the next phase should know:** gotchas, patterns to follow, helpers to reuse.
```

### Phase 1 — Foundation (completed 2026-11-12)

**Built:** An Electron app (sandboxed renderer, context isolation, strict CSP) that starts a Python engine (FastAPI + PyMuPDF 2.1) on a random local port, authenticates every request with a per-launch token, shows the engine's state in the status bar, restarts the engine once if it dies, and kills it on quit. The shell has a toolbar of placeholder buttons, an empty tab strip, a collapsible side panel, an empty state, a status bar and the application menu. Light, dark and follow-system themes are persisted. Only one instance can run.

**Key files:**
- `src/main/index.ts` — start-up order, window, single instance, engine-failure dialog
- `src/main/engine.ts` and `engine-protocol.ts` — engine lifecycle; the pure helpers are unit-tested
- `src/shared/api.ts` — the `window.api` contract and IPC channel names
- `src/preload/index.ts` — the only bridge between renderer and main
- `src/renderer/src/api/engine.ts` — the engine client; add every new endpoint here
- `src/renderer/src/state/engine.ts` — follows engine status and drives the indicator and toasts
- `src/renderer/src/assets/main.css` — theme tokens for both colour schemes
- `engine/pdfengine/server.py` (`create_app`), `__main__.py` (launch contract), `errors.py`, `watchdog.py`

**Verification results** (all run on 2026-11-12):
- `pnpm dev` opens the window; the indicator reads "Engine connected · v0.1.0 · PyMuPDF 2.1". **Pass.** Console is clean (no CSP violations); `window.require` and `window.process` are undefined in the renderer.
- `pnpm test:engine`: **14 passed.** Health returns 200 with a valid token and 401 without one or with a wrong one; also covers the error shape, CORS preflight, the real process's ready line, refusal to start without a token, and the engine exiting when its owner process dies.
- Killing the engine's `python.exe` (force-terminated, as Task Manager does): **Pass.** The indicator went connected → "Engine reconnecting…" with a warning toast → connected again about 450 ms later on a new process, with a "running again" toast.
- Killing it a second time within 60 s: **Pass.** Retries stop, the indicator reads "Engine unavailable", a persistent error toast and a native dialog explain why, and "Try Again" brought the engine back.
- Closing the app leaves no engine process: **Pass** (gone about 0.5 s after the window closed, in development and in the built app). Force-killing only Electron's main process: the engine exited by itself in about 0.4 s.
- Theme choice survives a restart: **Pass.** Set to light with the OS in dark mode; the app restarted light. Setting left at "system" afterwards.
- Second launch: **Pass.** With the window minimised, a second launch exited with code 0 and the first window was restored to the foreground.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (21 passed), `pnpm build`: **Pass.**
- Built app loaded from `file://` (Electron run directly on `out/`): engine connected, console clean. **Pass.**
- Not run: a packaged build. The packaged engine path (`resources/engine/pdfengine.exe`) is wired in `src/main/engine.ts` but nothing exercises it until phase 7.

**Accepted exceptions:** none requested.

**Things the next phase should know:**
- Read "Commands" above before running the app from Claude Code: `ELECTRON_RUN_AS_NODE` must be cleared.
- New endpoints: add a route under the `/v1` router inside `create_app` (it already enforces the token), raise `EngineError` subclasses from `errors.py` for failures, and add a typed method to `engine` in `src/renderer/src/api/engine.ts`. Return camelCase JSON. `app.state.sessions` is the `SessionRegistry` to fill in.
- New main-process capabilities: add the channel to `IPC` and the method to `Api` in `src/shared/api.ts`, handle it in `src/main/ipc.ts`, expose it in `src/preload/index.ts`. The preload may import only `electron` and `src/shared`.
- The engine's port and token change on every restart. Anything that caches engine URLs (page images, blob URLs) must be invalidated when `useEngine`'s state returns to connected after a restart; `EngineStatus.generation` from main increases each time.
- Use `ptToPx` / `pxToPt` from `src/renderer/src/lib/units.ts` for every coordinate conversion.
- For dark-mode styling use Tailwind's `dark:` variant or the CSS variables; do not add a `.dark` class. To read the resolved scheme in script, use `matchMedia('(prefers-color-scheme: dark)')`.
- Toolbar and side-rail buttons use `shell/ToolbarButton.tsx`, which keeps tooltips on unavailable buttons by using `aria-disabled` instead of `disabled`.
- Add shadcn components with `pnpm dlx shadcn@latest add <name> -y`. If one imports `next-themes` (as `sonner` did), remove that import; the theme is the media query.
- Engine tests that start the real process should pass `PDFENGINE_PARENT_PID` and kill the process in a `finally` block, as `test_engine_process.py` does.

### Phase 2 — Viewer (completed 2026-11-13)

**Built:** A read-only reader. Files open from the Open dialog, drag-and-drop, the command line, a second launch, the empty state's recent list and File → Open Recent (last 15, missing files pruned); an open file is focused instead of reopened; protected files ask for their password and retry on a wrong one. Each document is a tab (close button, middle-click, Ctrl+W, Ctrl+Tab) that keeps its own page, zoom, layout, side panel and search. The engine renders pages (PNG, or JPEG for picture pages, within a 40 MP budget); the viewer mounts only pages near the view, sizes every page before images load, shows a stretched image of another scale while the sharp one loads, and caches images (192 MB, LRU, on-screen images pinned). Zoom 10–800 % by Ctrl+wheel (point under the cursor stays put), Ctrl +/−/0, buttons, the zoom box and presets, fit width and fit page. Continuous, single-page and two-page layouts. Rotate the current page or all pages. A transparent text layer gives native selection, and copying produces text with spaces and line breaks. Find (side panel, Ctrl+F) with match case and whole word, results grouped by page with snippets, hits drawn over the pages, Enter / Shift+Enter / F3 / Shift+F3, and an OCR hint for documents without text. Thumbnails and outline panels. A properties dialog. Documents are reopened automatically after an engine restart.

**Key files:**
- `engine/pdfengine/api.py` (routes), `sessions.py` (open, the PyMuPDF lock, `Session.mutated`), `render.py`, `text.py` (text layer data and search), `pages.py`, `info.py`
- `src/renderer/src/state/documents.ts` — every engine action on documents: open/close, password flow, rotate, search, reopen after restart, keeping menu and title in step
- `src/renderer/src/state/tabs.ts` — per-tab state
- `src/renderer/src/viewer/PageList.tsx` — scrolling, virtualisation, zoom anchoring, page turns, the `ViewerHandle` (`controller.ts`) that everything else steers it with
- `viewer/layout.ts`, `geometry.ts`, `zoom.ts` — the pure arithmetic, unit-tested
- `viewer/pageImages.ts` (image cache and request queue), `pageText.ts`, `TextLayer.tsx` + `textLayout.ts` + `selection.ts` (text layer, selection and copy)
- `src/renderer/src/shell/commands.ts` (all commands) and `shortcuts.ts` (all keys)
- `src/main/files.ts` (opening paths, recent files) and `menu.ts`

**Verification results** (2026-11-13; the app was driven over the DevTools protocol with generated PDFs: 620 pages with a 155-entry outline; mixed sizes with stored rotations; AES-256 protected; a 3-page scan; a small one):
- `pnpm test:engine`: **107 passed.** `pnpm test`: **124 passed.** `pnpm lint`, `pnpm typecheck`, `pnpm build`: **pass.**
- 500+ page PDF: first page image about 70 ms after the tab appeared (the open call itself about 100 ms). Scrolling all 620 pages at 300 px per frame: median frame 16.7 ms, 95th percentile 27 ms, worst 47 ms; 2–6 pages mounted at any time. Afterwards the image cache held 113 MB (cap 192 MB), the JS heap 58 MB and the engine 105 MB, unchanged from before the scroll. **Pass.**
- Zoom 10 %–800 % with the wheel, buttons, keys and box: the word under the cursor stays under it zooming in and back out; after settling the image is pixel-exact from 10 % to 400 %, and at 800 % limited by the 40 MP budget as planned. **Pass.**
- Select text across lines and copy: the selection spans the lines and the clipboard holds the same text with a line break between lines. **Pass.**
- Search: hits found, Enter / F3 / Shift+Enter step through them, the active highlight covers its word at 50 %, 100 % and 250 %, after rotating its page with Ctrl+R, and at 200 % after the rotation. Text layers stay inside pages stored at 90° and 180°. **Pass.**
- Encrypted PDF: wrong password keeps the dialog with an error and an empty box; the right one opens it; Escape cancels. **Pass.**
- Three tabs each keep page and zoom (page 124 at 150 %, page 4 at fit width) through Ctrl+Tab, and the view really is on that page. **Pass.**
- Thumbnails jump to the clicked page and mark and follow the current page; outline entries jump (Part 6 → page 101). **Pass.**
- Dropping a PDF on the window opens it; a second launch with a path (`electron.exe . file.pdf`) exited with code 0 and the first window opened the file; the built app started cold with a path on its command line opened it. **Pass.**
- Also checked: engine killed with documents open → tabs reopened at the same pages; one engine session per tab and closing a tab frees it; closing the window leaves no engine or Electron process; the built app (`file://`) has a clean console.
- Not checked by hand: see the "Two checks were done by script" row under Known issues.

**Accepted exceptions:** none needed.

**Things the next phase should know:**
- Pages are **0-based** in the API and in tab state; only the UI adds 1.
- Every change to a document must call `Session.mutated(dirty_pages)` (bumps `revision`, returns the standard response) and hold `session.lock` while touching PyMuPDF. In the renderer, pass the result to `useTabs.getState().applyMutation(tabId, result, changedPages)`: images and text are cached by per-page revision (`pageRevisions`), so dirty pages re-render and nothing else does.
- Text and search coordinates from PyMuPDF are unrotated; convert with `page.rotation_matrix` before returning them (see `text.py`). The phase 3 quad merging can start from the text layer's word boxes, which are already in displayed space, and from `layoutLine` in `viewer/textLayout.ts`.
- `PageView.tsx` stacks image → search highlights → text layer. The annotation layer goes above the text layer; it must not block text selection when the select tool is active.
- Steer the viewer through `getViewer(tabId)` (`goToPage`, `reveal`, `zoomTo`, `holdPage` before changing page sizes).
- New commands: id in `MENU_COMMANDS` (`src/shared/api.ts`), case in `shell/commands.ts`, key in `shell/shortcuts.ts`, entry in `main/menu.ts` via `command(...)`. Do not register accelerators in the menu.
- Driving the app from a script: start it with `pnpm exec electron-vite dev --remoteDebuggingPort 9222`; in development `import('/src/…')` from the DevTools protocol reaches the app's own modules (for example `import('/src/state/documents.ts').then(m => m.openPath(path))`).
- A ResizeObserver does not fire while the window gets no frames (in the background); measure synchronously on mount as `PageList` does.
