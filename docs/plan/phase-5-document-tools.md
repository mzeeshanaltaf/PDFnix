# Phase 5 — Document Tools

**Goal:** tools that work on the document's structure and sensitive content: page management, form filling, redaction, and watermarks, headers, footers and page numbers.

**Depends on:** phases 1–4 (edit pipeline, annotations, overlay).

## Scope

Included: reorder, delete, duplicate, insert blank, extract, split and merge pages; fill and flatten interactive forms; mark and apply redactions, including search-and-redact; text and image watermarks; headers, footers and page numbers.

Not included: creating new form fields; Bates numbering.

## Engine

New modules: `pages.py` (extended), `forms.py`, `redact.py`, `watermark.py`.

### Page management

| Endpoint | Purpose |
|---|---|
| `POST /v1/docs/{id}/pages/reorder` `{ order: [..] }` | New page order (`doc.select`) |
| `POST /v1/docs/{id}/pages/delete` `{ pages }` | Delete pages; refuses to delete all pages |
| `POST /v1/docs/{id}/pages/duplicate` `{ pages }` | Copy pages after themselves |
| `POST /v1/docs/{id}/pages/insert-blank` `{ at, width, height, count }` | Blank pages; size defaults to the neighbouring page |
| `POST /v1/docs/{id}/pages/insert-pdf` `{ path, password?, at, fromPages? }` | Merge another PDF in at a position (`doc.insert_pdf`; inside a journal operation only through `compat.insert_pdf`, which runs PyMuPDF's Python path — see STATUS.md, Verified facts) |
| `POST /v1/docs/{id}/pages/extract` `{ pages, outPath }` | Write the chosen pages to a new file; the open document is unchanged |
| `POST /v1/docs/{id}/split` `{ mode: "ranges" \| "every" \| "bookmarks", ranges?, n?, outDir, nameTemplate }` | Write several files; returns the list of paths |
| `POST /v1/merge` `{ inputs: [{ path, password?, pages? }], outPath }` | Combine files without opening them in tabs |

All in-document operations return the standard mutation response with the new `pageCount` and page sizes, and are undoable. Outline entries and links pointing at moved or deleted pages are kept consistent where PyMuPDF does this for us; test for it.

### Forms

| Endpoint | Purpose |
|---|---|
| `GET /v1/docs/{id}/forms` | `[{ fieldId, page, rect, type, name, value, options?, flags: { readOnly, required, multiline, … } }]` from `page.widgets()`. Types: text, checkbox, radio, combo box, list box, signature (shown but not fillable) |
| `POST /v1/docs/{id}/forms/values` `{ values: [{ fieldId, value }] }` | Set values (`widget.field_value`, `widget.update()`); one undo step per call |
| `POST /v1/docs/{id}/forms/flatten` | Turn fields into ordinary page content (`doc.bake`) so they can no longer be edited |
| `POST /v1/docs/{id}/forms/reset` | Clear all values |

### Redaction

| Endpoint | Purpose |
|---|---|
| `POST /v1/docs/{id}/redactions` `{ page, rects \| quads, fill, overlayText? }` | Mark for redaction (`page.add_redact_annot`). Nothing is removed yet |
| `GET /v1/docs/{id}/redactions` | Pending marks |
| `DELETE /v1/docs/{id}/redactions/{annotId}` | Remove a mark |
| `POST /v1/docs/{id}/redactions/search` `{ query, matchCase, wholeWord, pages? }` | Mark every match |
| `POST /v1/docs/{id}/redactions/apply` | Permanently remove the content under all marks (`page.apply_redactions`), including the overlapped parts of images |

After applying, the engine also offers (and by default performs) metadata clean-up for the save: redaction is only meaningful if the removed content cannot be recovered, which the full-rewrite save from phase 3 with garbage collection already ensures. Add a test that the redacted text is absent from the raw bytes of the saved file.

### Watermark, headers, footers, page numbers

| Endpoint | Purpose |
|---|---|
| `POST /v1/docs/{id}/watermark` `{ kind: "text" \| "image", text?, imagePath?, fontSize, color, opacity, rotation, position, scale, layer: "over" \| "under", pages }` | Draw the watermark on each page in the range |
| `POST /v1/docs/{id}/header-footer` `{ header: { left, center, right }, footer: { left, center, right }, font, size, color, margins, pages, startNumber }` | Text fields support the tokens `{page}`, `{pages}`, `{date}`, `{filename}` |

Both are page-content changes applied as one undo step. Positions respect each page's rotation and size.

## Renderer

**Page organiser** (`panels/Thumbnails` grows an "Organise" mode, also available as a full-window grid)

- Multi-select with Ctrl/Shift click; drag to reorder with an insertion marker; Delete key; context menu: rotate, duplicate, delete, extract, insert blank before/after, insert from file.
- Dropping a PDF file onto the grid inserts it at that position.
- `dialogs/Split` and `dialogs/Merge` (file list with drag-to-order and optional page ranges).

**Forms** (`viewer/FormLayer`)

- Real HTML inputs positioned over each field's rectangle, styled to match the field's size and font: text inputs and text areas, checkboxes, radio groups, selects.
- Tab and Shift+Tab move between fields in document order. Values are sent to the engine on blur, batched.
- A bar appears when a document has fields: "This document has a form" with Highlight fields, Reset and Flatten.
- Required fields are marked; read-only fields are not editable.

**Redaction** (`tools/Redact`)

- Mark by selecting text or dragging a rectangle. Pending marks are drawn as red outlines so the content can still be reviewed.
- `dialogs/Redact`: list of pending marks, search-and-redact, fill colour, optional overlay text, and an **Apply** button behind a clear confirmation that this cannot be reversed after saving.
- Applying is still undoable within the session, like every other edit.

**Watermark and header/footer** (`dialogs/Watermark`, `dialogs/HeaderFooter`)

- Live preview on the current page, page-range selector, presets such as "CONFIDENTIAL" and "DRAFT", and "Page {page} of {pages}".

## Tests

Engine: reorder yields the expected page sequence (checked via known page text); delete, duplicate and insert-blank counts; merge keeps all pages in order and handles an encrypted input; split by ranges, every N and bookmarks produces the right files; outline targets remain valid after reorder; form values round-trip for every field type and flatten removes the widgets while keeping the visible values; redacted text is not extractable and not present in the saved bytes, while neighbouring text survives; partially covered images lose only the covered region; watermark and page numbers appear on exactly the requested pages and are positioned correctly on rotated and mixed-size pages; token substitution.

Renderer: organiser selection and drag-reorder logic; form layer field mapping and tab order; page-range parser (`1-3, 7, 10-`).

## Verification

- Reorder, delete and duplicate pages in a 50-page document; undo each; save and reopen.
- Merge three PDFs, split the result back into parts.
- Fill a real-world form (a government or tax form is a good test), save, reopen in Adobe Reader and confirm the values; flatten and confirm they are no longer editable.
- Redact a name everywhere by search, apply, save, then confirm the name cannot be found by search or copy-paste in any reader.
- Add a diagonal "DRAFT" watermark and "Page X of Y" footers to a document with mixed page sizes and one rotated page.

## Done when

All four tool groups work on real documents, redaction is verifiably permanent, and tests pass.
