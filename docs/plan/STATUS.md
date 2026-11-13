# Project Status

Single source of truth for where the project stands. Read fully at the start of every session; update during and at the end of every session. The protocol is in `CLAUDE.md` at the project root.

**Last updated:** 2026-11-13 — phase 3 session (phase 3 complete, committed and pushed)

## Phases

| # | Phase | Plan | Status | Started | Completed |
|---|---|---|---|---|---|
| 1 | Foundation | [phase-1-foundation.md](phase-1-foundation.md) | Complete | 2026-11-12 | 2026-11-12 |
| 2 | Viewer | [phase-2-viewer.md](phase-2-viewer.md) | Complete | 2026-11-13 | 2026-11-13 |
| 3 | Annotations and save | [phase-3-annotations-and-save.md](phase-3-annotations-and-save.md) | Complete | 2026-11-13 | 2026-11-13 |
| 4 | Content editing and signatures | [phase-4-content-editing-and-signatures.md](phase-4-content-editing-and-signatures.md) | Not started | – | – |
| 5 | Document tools | [phase-5-document-tools.md](phase-5-document-tools.md) | Not started | – | – |
| 6 | Processing jobs | [phase-6-processing-jobs.md](phase-6-processing-jobs.md) | Not started | – | – |
| 7 | Packaging and release | [phase-7-packaging-and-release.md](phase-7-packaging-and-release.md) | Not started | – | – |

Status values: Not started · In progress · Complete · Complete with accepted exceptions.

## Current position

- **Current phase:** 4 — Content editing and signatures (not started)
- **Next action:** in a new session, follow the start-of-session steps in `CLAUDE.md`, then begin phase 4 from [phase-4-content-editing-and-signatures.md](phase-4-content-editing-and-signatures.md). Read the phase 3 handoff note first, and the rules for edits added to the phase 3 plan under "Edit pipeline" ("Decided"): every phase 4 edit must follow them.
- **Uncommitted work:** none. Phases 1–3 are committed on `main` and pushed to `origin` (https://github.com/mzeeshanaltaf/PDFnix.git); the user asked for the phase 3 push. Ask before pushing later phases unless told otherwise.

## Current phase progress

Checklist for the phase in progress. The session that starts a phase writes this list from the phase plan, ticks items as they are finished, and clears it when the phase completes (the summary then goes into the handoff note).

- [ ] (to be written when phase 4 starts)

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
- Development uses its own settings folder, `%APPDATA%\PDFnix-dev` (the installed app will use `%APPDATA%\PDFnix`). Recovery copies are in its `recovery` subfolder; delete them there to stop the recovery offer during testing. `PDFENGINE_RECOVERY_DELAY` (seconds) shortens the 2-minute wait when running the engine by hand.
- Native dialogs (Save As, "Save changes?") cannot be clicked over DevTools. In phase 3 they were driven with `WScript.Shell` `AppActivate('Save As'` / `'PDFnix')` + `SendKeys`; Alt+F4 to the main window (activate it by its process id) tests the real close path. A page-initiated `window.close()` does **not** go through it (see Verified facts).

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
| Does PyMuPDF journalling cover all edit types for undo/redo? | **Yes for phase 3's edits**: highlight/underline/strikeout/note creation, colour, opacity, contents, `set_rect` (move), `delete_annot` and `set_rotation` all undo and redo exactly; xrefs survive undo/redo; a new op after undos discards the redo steps; an op that changes nothing records no step; 200 ops + 200 undos take ~30 ms. `save(garbage=3)` and `tobytes` work with the journal on and keep the history. **Caveats:** (1) with the journal on, *any* change outside `journal_start_op`/`journal_stop_op` raises `FzErrorArgument: Can't alter an object other than in an operation` — and PyMuPDF's `Page.get_textpage`, `get_text`, `search_for`, `get_image_info` and `get_texttrace` call `set_rotation(0)` temporarily on rotated pages, so they fail there. Use `textpages.py` (builds the text page with `page._get_textpage(clip, flags, derotation_matrix)`, output identical at 0/90/180/270 and with offset cropboxes). (2) An op that raises midway keeps its partial changes as a step; `history.py` undoes it. (3) **Any write of the document** (`save`, `tobytes`, incremental or not, `pdf_write_snapshot`) **corrupts later undos**: MuPDF's `do_pdf_save_document` ends with `doc->num_incremental_sections = 0`, after which undo restores wrong objects (e.g. one undo does nothing, the next jumps back). Fix: `History.serialise()` saves that field (`pymupdf._as_pdf_document(doc).m_internal.num_incremental_sections`) before `tobytes` and restores it after; verified at every history position, encrypted and not, including new branches after a write. It is a private field — `test_undo_still_works_after_saving` guards it; re-check on every PyMuPDF upgrade. (4) `garbage` ≥ 2 additionally renumbers objects of the open document, so the working document is only written with garbage 0 and a throwaway copy is compacted. (5) A journal (`journal_save`) holds only the *old* values of changed objects, so it cannot be replayed onto the original file (`journal_load` → "Journal and document do not match"). Re-check later edit types (insert_pdf, delete pages, redactions, OCR) when their phase adds them | 3 (all later) | 2026-11-13 |
| Annotation coordinate spaces in PyMuPDF 2.1 | Inconsistent on rotated pages: `add_highlight_annot`/`add_underline_annot`/… and `Annot.vertices`, `Annot.rect`, `Annot.set_rect` use the **unrotated** space; `add_text_annot(point)` passes the point to MuPDF in the **displayed** space; notes carry NoRotate (flags 28), so their drawn box is anchored at a rotation-dependent corner. `mupdf.pdf_bound_annot(annot.this)` equals the rendered pixels in displayed space at every rotation, and moving `pdf_annot_rect` by a displayed offset moves the drawn box by the same offset. `annotations.py` is built on these two | 3, 4 | 2026-11-13 |
| Does a page-initiated `window.close()` fire `BrowserWindow`'s `close` event? | No: the window closes without it, so the unsaved-changes handshake is skipped. The app never calls `window.close()`; the window's close button, Alt+F4 and File → Exit (`app.quit`, caught in `before-quit`) all go through the handshake | 3, 7 | 2026-11-13 |
| Do Edge and Acrobat show PDFnix's annotations? | Yes. A file saved by PDFnix showed its highlights and note in Microsoft Edge (the version installed on 2026-11-13) and in Adobe Acrobat 26.002 (64-bit); Acrobat's Comments pane listed all five annotations (highlight, note with text, two underlines, strikeout with comment) with author and time | 3 | 2026-11-13 |
| Annotation details | `Annot.set_info(content=…)` ignores an empty string (use `mupdf.pdf_set_annot_contents`). New annotations have empty creation/modification dates; set them with `pymupdf.get_pdf_now()`. `annot.opacity` is -1 when unset. A temporary page (`doc[i].add_…(…).update()` in one expression) can be collected before `update()` → "annotation not bound to any page"; keep the page in a variable | 3, 4 | 2026-11-13 |
| Does saving keep a document's encryption? | Only with `encryption=pymupdf.PDF_ENCRYPT_KEEP` (0). The default `encryption=1` is `PDF_ENCRYPT_NONE` and silently **decrypts**. With KEEP, AES-256, both passwords and the permissions survive, whether the file was opened with the user or the owner password, with `garbage=3` and the journal on | 3, 6 | 2026-11-13 |
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
| 2026-11-13 | 3 | **Undo uses PyMuPDF journalling** (not byte snapshots), with the workarounds in Verified facts: reads go through `textpages.py`, writes through `History.serialise()`, and every change through `Session.edit(name)` | The spike showed journalling covers all phase 3 edits exactly and costs ~nothing; the two MuPDF problems found have contained fixes | Phase 3 |
| 2026-11-13 | 3 | Every mutation response also carries `pages` (size/rotation of each dirty page) and the undo state `canUndo, canRedo, undoName, redoName, modified`; undo/redo add `undone`/`redone` (the step name). Open responses carry the undo state too | The renderer needs the undo state after every edit, and page sizes after undoing a rotation (and later page operations) | – |
| 2026-11-13 | 3 | Modified state is `modified` (journal position ≠ position at last save; unreachable once a new step replaces it), computed by the engine, instead of the renderer comparing `revision` with `savedRevision`. `/state` returns `{ path, fileName, revision, canUndo, canRedo, undoName, redoName, modified }` | `revision` also rises on undo, so undoing back to the saved state would still look modified | Phase 3 |
| 2026-11-13 | 3 | Save writes `History.serialise()` → reopens as a throwaway copy → `save(garbage=3, deflate=True, encryption=PDF_ENCRYPT_KEEP)` to a temp file in the target folder → `os.replace`. Error codes: `file_locked` (409), `file_read_only` (403), `folder_not_found` (404), `folder_not_writable` (403), `disk_full` (507), `save_failed` (500). Save responds `{ path, fileName, …state }` | Keeps the journal and annotation ids intact across saves; distinct errors for the user | – |
| 2026-11-13 | 3 | Annotation API: create takes optional `author` and `contents` (renderer sends the configured author); PATCH/DELETE take an optional `?page=` hint (otherwise every page is searched); only notes can be moved in phase 3; annotations of other types already in a file are listed (type names like `square`, `ink`, `freetext`) and can be recoloured, commented and deleted. Popups, widgets and links are not listed. New notes use the "Comment" icon | Small additions the plan left open | – |
| 2026-11-13 | 3 | Recovery copies: engine env `PDFENGINE_RECOVERY_DIR` (main passes `<userData>/recovery`) and `PDFENGINE_RECOVERY_DELAY` (tests). A copy is written once an unsaved change is 2 minutes old (checked every 5 s), when the window reloads (`DELETE /v1/docs` now keeps unsaved work as copies), on engine shutdown, and when the engine's owner process dies; deleted on save, close, or undo back to saved. New endpoints `GET /v1/recovery`, `POST /v1/recovery/{id}/open {password?}` (opens like `/docs/open`, `modified: true`, the copy then belongs to the new session), `DELETE /v1/recovery/{id}`. Copies of encrypted files stay encrypted; the password is never stored | The plan named the behaviour, not the API. Writing on reload/owner death keeps work that the 2-minute timer would lose | – |
| 2026-11-13 | 3 | New engine modules beyond the plan: `textpages.py`, `recovery.py` | See Verified facts; recovery is its own concern | – |
| 2026-11-13 | 3 | Renderer: all document changes go through `state/edits.ts` (`mutate` queues them per tab and applies the result; `rotatePages` moved there from `documents.ts`). `documents.ts` keeps open/save/close/recovery/search. `viewer/pageText.ts` is now a generic `PageDataStore<T>` serving `pageTexts` and `pageAnnotations`, both keyed by page revision — so an annotation change also re-fetches that page's text layer | One path for every edit; one cache implementation | – |
| 2026-11-13 | 3 | Tools and keys: Select (V), Highlight (H), Underline (U), Strikeout (K), Note (N); with text selected H/U/K mark it at once, otherwise they arm the tool (pressing again disarms). Delete/Backspace deletes the selected annotation, Escape closes the pop-up → deselects → returns to Select. Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z (left to text boxes while typing), Ctrl+S, Ctrl+Shift+S, Ctrl+, (Preferences). Tools also in a new Tools menu section; Edit menu shows "Undo Highlight" etc. A colour button next to the tools sets the armed tool's colour (per tool, not persisted; the default highlight colour is a setting) | The plan named the tools, not their keys | – |
| 2026-11-13 | 3 | A text selection spanning several pages becomes one markup annotation **per page**, each its own undo step. Partial words are cut in proportion to their characters (matching the selection band the text layer shows) | Annotations belong to one page | – |
| 2026-11-13 | 3 | Settings: File → Preferences… (author name, empty = Windows user name; default highlight colour). Stored by main in `electron-store` (`authorName`, `highlightColor`), exposed as `window.api.settings` | The plan asked for the settings, not where they live | – |
| 2026-11-13 | 3 | Closing: main intercepts the window's `close` and `before-quit` and asks the renderer (`app:closeRequest`); the renderer asks Save / Don't Save / Cancel per modified tab with a **native** message box (`window.api.dialogs.confirmUnsaved`) and replies `app:confirmClose`. The engine is now stopped in `will-quit`, not `before-quit`. Without a connected engine nothing is asked. Save As refuses a path that is open in another tab | Native dialogs match Windows; stopping the engine only once quitting is certain keeps it alive when the user cancels | – |
| 2026-11-13 | 3 | Recovery in the renderer: offered in a dialog at start-up (Restore / Discard per file, "Decide later" keeps them); after an engine restart, a modified tab is reopened from its recovery copy if one exists (toast says changes of the last two minutes may be missing), else from disk with a warning | Plan said "offer to restore"; the engine-restart part was carried over from phase 2 | – |
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
| If the engine (not the app) crashes, changes newer than the last recovery copy are lost | 3 | Low, by design | Copies are written 2 minutes after a change, on window reload, on engine shutdown and when the app dies — but a killed engine cannot write one. The tab comes back from the last copy (or the file) with a toast saying so |
| Changing an annotation rebuilds that page's text layer | 3 | Cosmetic | Text, images and annotations share the page revision. The text does not change; it is fetched again (a few ms) |
| The annotation toolbar and comment pop-up live inside the page | 3 | Low | They are clipped by the page's edges (and by the view when the page is wider than the window). Placement keeps them on the page where it can |
| Document permissions are not enforced | 3 | Low | A file opened with its *user* password whose permissions forbid annotating or modifying can still be annotated and saved (the permissions themselves are preserved). See Carried over |
| Cancelling a new note's pop-up leaves an empty note | 3 | Low | Same as Acrobat; it can be deleted (Delete key or the Comments panel) |
| The selection toolbar's colour fix was not re-checked in the running app | 3 | Low | After the last run the toolbar's markup buttons use each tool's own colour unless a swatch is picked (the run had shown a yellow underline). Logic change only; lint, types and tests pass |
| At high zoom very large pages are slightly soft | 2 | Low, by design | A page image is capped at 40 MP (plan). E.g. A3 landscape at 800 % is drawn from a 7,522 px wide image stretched to 12,704 CSS px. A4 at 800 % on a 1× display is just over the cap too. Tiled rendering would remove this |
| The selection highlight shows hairline seams between some words | 2 | Cosmetic | Each word is its own span stretched to the next word; sub-pixel rounding leaves thin gaps or overlaps. Copy is unaffected |
| Two checks were done by script, not by eye or hand | 2 | Low | The native File → Open Recent submenu (built from the same list the empty state shows, which was checked) and Ctrl+C through the Electron menu's Copy role (the copy itself was checked with `document.execCommand('copy')`, which raises the same `copy` event) |
| In development the first document opened after `pnpm dev` can make Vite optimise a dependency and reload the page | 2 | Low, development only | Seen once (`class-variance-authority`). The reload closes the tabs; open the file again |

## Carried over

Work or ideas deferred to a later phase, and questions waiting for the user.

| Item | Target phase | Notes |
|---|---|---|
| Enable toolbar buttons and menu entries as features arrive | 4–6 | Print, Pan and the phase 4 tools (text, image, shape, sign) are still disabled in `shell/Toolbar.tsx` (a tool without a `command` is shown disabled); `menu.ts` uses `placeholder(...)` for entries not yet implemented. New menu commands: add the id to `MENU_COMMANDS` in `src/shared/api.ts`, handle it in `shell/commands.ts`, give it a key in `shell/shortcuts.ts` |
| Pan (hand) tool | 4 | On the toolbar since phase 1, never implemented and not in any plan. Add with the other phase 4 tools or drop it |
| Moving and resizing other annotation types | 4 | `annotations.py` only lets notes move (`_MOVABLE`). Free text, shapes, ink and images need move/resize; use `_move_to` (displayed-space offsets) as the pattern |
| Respect document permissions | 5 | Opened with the user password, a file may forbid annotating/modifying (`info.py` already reports `permissions`). Decide whether to block edits or warn; fits with phase 5's security work |
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

### Phase 3 — Annotations and save (completed 2026-11-13)

**Built:** Highlight, underline and strikeout (select text then press H/U/K or use the floating toolbar, or arm the tool and drag), sticky notes (N, click to drop, type in the pop-up), comments on any annotation, selecting annotations (click; markup is hit-tested so text under it stays selectable), recolour/comment/delete from a floating toolbar, dragging notes, the Comments panel (grouped by page, author and time, filter by type, click to jump, edit and delete in place). Undo/redo of every change including rotation, with step names in the Edit menu and toolbar tooltips. Save (atomic, compacted, encryption kept), Save As, a modified dot on tabs and `*` in the title, Save / Don't Save / Cancel when closing a tab or quitting. Preferences (author name, default highlight colour). Recovery copies with a restore offer at start-up, and tabs reopened from them after an engine restart.

**Key files:**
- Engine: `history.py` (journal, step names/pages, modified, `serialise`), `sessions.py` (`Session.edit`, `mutated`, `describe`), `annotations.py`, `save.py`, `recovery.py`, `textpages.py`, routes in `api.py`
- Renderer: `state/edits.ts` (every change), `state/documents.ts` (open/save/close/recovery), `viewer/AnnotationLayer.tsx`, `tools/quads.ts` + `tools/hitTest.ts` (pure, tested), `tools/SelectionToolbar.tsx`, `panels/Comments.tsx`, `viewer/selection.ts` (`selectedWordPieces`)
- Main: close handshake in `index.ts`, settings in `settings.ts`, dialogs in `ipc.ts` / `files.ts`

**Verification results** (2026-11-13):
- `pnpm test:engine`: **156 passed.** `pnpm test`: **149 passed.** `pnpm lint`, `pnpm typecheck`, `pnpm build`: **pass.**
- The app was driven over the DevTools protocol with real mouse and keyboard input (`Input.dispatchMouseEvent` / `dispatchKeyEvent`), native dialogs with `SendKeys`, on generated 5-page and AES-256 protected PDFs:
- Highlight across two lines starting mid-word, underline and strikeout on a page stored at 90°, highlight by dragging with H armed, underline from the selection toolbar: drawn exactly over the selected text, colours as picked. **Pass.**
- Note dropped with the note tool, typed in its pop-up, saved with Ctrl+Enter; a highlight selected by clicking it, recoloured from its toolbar; note dragged (+60/+40 pt, clamped at the page edge); Delete and Ctrl+Z. **Pass** (after two fixes, below).
- Comments panel lists notes and commented annotations by page with author/time, filters, jumps to and selects the annotation on click. **Pass** (after a fix).
- Mixed sequence (highlight, note, strikeout, rotate, recolour, comment) undone step by step in reverse back to the unmodified original (`*` and dot gone), then redone. **Pass.**
- Ctrl+S on the protected file, close, reopen with the password: rotation, annotations, colours, author and comment all there; PyMuPDF confirms AES-256 R6 encryption and the original permissions are kept. Save As through the native dialog moves the tab to the new file; the original is untouched. **Pass.**
- Opened the saved file in Microsoft Edge and in Adobe Acrobat 26: highlights and note shown; Acrobat's Comments pane lists all five annotations with author, time and text. **Pass.**
- Save while another process holds the file open: "…is open in another program…" toast with a Save As button, file byte-for-byte unchanged, no temp file left; saving works once it is released. **Pass.**
- Force-killed Electron's main process seconds after an unsaved change: the engine wrote a recovery copy as its owner died and exited; on restart the copy was offered and Restore brought the change back (tab modified). Reloading the window (F5) and killing only the engine also restore from copies. **Pass.**
- Alt+F4 with unsaved changes: Cancel keeps the app; Don't Save quits with no Electron or engine process left and the copy removed. Close tab: Cancel keeps it, Don't Save closes it, the file keeps its last saved state. **Pass.**
- Found and fixed during these runs: the page's native click listener deselected the annotation when its own toolbar was clicked (React's `stopPropagation` does not reach native listeners); the Comments panel stayed on "Loading…" when its first fetch was cancelled (React runs effects twice in development); the recovery dialog's long paths pushed its buttons out of view; the selection toolbar gave underline/strikeout the highlight colour (fix not re-run in the app, see Known issues).
- Not checked by a person: everything above was scripted with real input events; nobody has used the tools by hand yet.

**Accepted exceptions:** none needed.

**Things the next phase should know:**
- Read the "Decided" rules under "Edit pipeline" in the phase 3 plan before writing any edit: `Session.edit(name)` around every change, `textpages.py` for every text/image read, `History.serialise()` for every write of the working document, never `garbage` ≥ 2 on it. Breaking these corrupts undo silently.
- Re-run the journalling checks for each new kind of edit (insert images, free text, redaction, page operations): undo, redo, and undo after a save. `test_history.py` and `test_save.py` show how.
- In the renderer, make changes with `mutate(tabId, (docId) => engine.…, 'Could not …')` from `state/edits.ts`; it queues per tab, applies `pages`/`dirtyPages`/undo state, and re-runs search if a page turned.
- New annotation geometry: read with `pdf_bound_annot` (displayed space), move with displayed-space offsets (`_move_to`). PyMuPDF's own rects and `add_*` calls mix rotated and unrotated spaces.
- Native listeners on the page element see every press inside it, including the annotation layer's controls; mark controls with a class in `OWN_CONTROLS` (`AnnotationLayer.tsx`) or check `event.target`.
