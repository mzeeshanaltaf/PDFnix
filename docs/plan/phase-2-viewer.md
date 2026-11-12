# Phase 2 — Viewer

**Goal:** a complete read-only PDF reader: open files in tabs, scroll, zoom, rotate, navigate with thumbnails and the outline, select and copy text, and search.

**Depends on:** phase 1 (architecture and conventions are defined in [phase-1-foundation.md](phase-1-foundation.md)).

## Scope

Included: opening (dialog, drag-and-drop, command line, recent files), password-protected files, rendering, continuous scroll, single and two-page layouts, zoom, rotate, page navigation, thumbnails, outline, tabs, text selection and copy, search, document properties.

Not included: any change that is saved to the file except rotation, which becomes saveable in phase 3.

## Engine

New modules: `sessions.py` (filled in), `render.py`, `text.py`, `pages.py` (rotation only for now).

| Endpoint | Purpose |
|---|---|
| `POST /v1/docs/open` `{ path, password? }` | Opens a working copy. Returns `{ docId, pageCount, pages: [{ width, height, rotation }], title, isEncrypted, hasTextLayer, revision }`. If a password is needed and missing or wrong: 401 with code `password_required` / `password_incorrect` |
| `DELETE /v1/docs/{id}` | Closes the session and frees memory |
| `GET /v1/docs/{id}/pages/{n}/render?scale=&format=webp` | Page image at the given scale (`page.get_pixmap` with a scale matrix). Response has an `ETag` of `revision-page-scale` |
| `GET /v1/docs/{id}/pages/{n}/text` | Words and lines with boxes: `{ lines: [{ bbox, words: [{ text, bbox }] }] }` |
| `GET /v1/docs/{id}/outline` | Table of contents: `[{ title, page, level }]` |
| `GET /v1/docs/{id}/info` | Metadata, file size, PDF version, encryption and permission flags |
| `POST /v1/docs/{id}/search` `{ query, matchCase, wholeWord }` | `[{ page, quads, snippet }]` using `page.search_for` plus surrounding text for the snippet |
| `POST /v1/docs/{id}/pages/rotate` `{ pages, degrees }` | `page.set_rotation`; returns the standard mutation response with new page sizes |

Notes:

- A session opens the document from an in-memory copy of the file bytes, so the file on disk is not locked and can be overwritten on save later.
- Rendering runs in a small thread pool. PyMuPDF documents are not thread-safe, so each session has a lock around document access.
- Cap the render scale so a single page image never exceeds a sensible pixel budget (about 40 megapixels); beyond that the renderer scales the image with CSS.

## Renderer

`viewer/`

- `PageList` — virtualised vertical list (only pages near the viewport are mounted). Page slots are sized from the page dimensions returned at open, so the scrollbar is correct before any image loads.
- `PageView` — one page: image, then the text layer, with slots for the annotation, form and edit layers added in later phases.
- `TextLayer` — transparent, absolutely positioned spans built from the word boxes so the browser's own selection and Ctrl+C work. Fetched lazily per visible page.
- `usePageImage` — fetches and caches page images keyed by `(docId, page, scale, revision)` with a size-bounded cache; shows the previous-scale image stretched while the sharp one loads.
- `geometry.ts` — the single points ↔ pixels helper, including rotation.

`panels/`

- `Thumbnails` — low-scale renders, current page marked, click to jump.
- `Outline` — collapsible tree from the outline endpoint; hidden when the document has none.
- `Search` — query box, match case / whole word, result list with snippets grouped by page, next/previous (Enter, Shift+Enter, F3), hit highlights drawn over the pages. When `hasTextLayer` is false, show a hint that the document needs OCR (the OCR action itself arrives in phase 6).

Shell

- Tab strip: one tab per document, close button, middle-click close, Ctrl+Tab to cycle. Per-tab state: page, zoom, layout, side panel.
- Toolbar: open, page number box with total, previous/next, zoom out / zoom in / zoom box with presets, fit width, fit page, rotate left, rotate right, layout switch, search toggle.
- Zoom: 10–800 %. Ctrl+wheel and Ctrl +/−/0. During a gesture the pages are scaled with CSS; the sharp re-render is requested when the zoom settles. Zooming keeps the point under the cursor stationary.
- Rotate applies to the current page by default, with "all pages" in the dropdown.
- Password prompt dialog for encrypted files, with retry on a wrong password.
- Document properties dialog.

Main process

- File open dialog (`.pdf` filter), drag-and-drop onto the window, a path given on the command line, and hand-off from a second instance all funnel into one `openFile(path)`.
- Recent files list (last 15) in `electron-store`, shown on the empty state and under File → Open Recent; missing files are pruned.
- Opening a file that is already open focuses its tab.

## Tests

Engine (pytest, fixture PDFs generated with PyMuPDF in `conftest.py`): open and page metadata; wrong and correct password; render returns an image of the expected pixel size for a given scale; text boxes fall inside the page; search finds known strings with correct page numbers and honours match-case; rotation changes reported sizes; closing frees the session.

Renderer (vitest): geometry helper under zoom and all four rotations; tab store behaviour; cache eviction.

## Verification

- Open a 500+ page PDF: first page appears quickly, scrolling stays smooth, memory stays bounded.
- Zoom from 10 % to 800 % with wheel and buttons; text stays sharp once settled.
- Select text across lines and paste it elsewhere correctly.
- Search a term, step through hits, confirm highlights line up with the text at several zoom levels and after rotating a page.
- Open an encrypted PDF with wrong then right password.
- Open three documents in tabs; each keeps its own position and zoom.
- Thumbnails and outline jump to the right pages.
- Drag a PDF onto the window; launch the app a second time with a file path and see it open in the first window.

## Done when

The app is a comfortable everyday reader for ordinary, large, rotated and encrypted PDFs, and all tests pass.
