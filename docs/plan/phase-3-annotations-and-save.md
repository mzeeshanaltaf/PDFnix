# Phase 3 — Annotations and Save

**Goal:** the user can highlight text, add comments, undo and redo, and save the result. This phase introduces the edit pipeline that every later feature uses.

**Depends on:** phases 1–2. Conventions are in [phase-1-foundation.md](phase-1-foundation.md).

**From phase 2** (details in STATUS.md): `page` is a 0-based index in every endpoint. Mutations go through `Session.mutated` in `engine/pdfengine/sessions.py` under the process-wide PyMuPDF lock, and the renderer applies the result with `applyMutation` in `state/tabs.ts`. The renderer currently turns search hits itself when a page is rotated; once rotation is undoable, re-run the search after an undo or redo instead.

## Scope

Included: highlight, underline, strikeout; sticky notes; comments on any annotation; comments panel; select, move, recolour and delete annotations; undo/redo; Save, Save As; unsaved-changes handling; crash recovery copy.

Not included: free text, shapes, ink, images, signatures (phase 4).

## Edit pipeline (used by all later phases)

1. The renderer calls a mutating endpoint.
2. The engine wraps the change in one journal operation, applies it, bumps `revision` and returns `{ revision, dirtyPages, pageCount }`.
3. The renderer invalidates cached images and text for the dirty pages and marks the tab as modified.

**Undo/redo** uses PyMuPDF journalling: `doc.journal_enable()` at open, `journal_start_op(name)` / `journal_stop_op()` around each change, `journal_undo()` / `journal_redo()`, with `journal_can_do()` driving the enabled state of the buttons. The operation name is shown in the Edit menu ("Undo Highlight").

Fallback, if journalling turns out not to cover an operation type reliably with the pinned PyMuPDF version: keep a per-operation snapshot of the document bytes (bounded stack, e.g. 30 steps) and restore from it. Decide this early in the phase with a spike test, because every later phase relies on it.

## Engine

New modules: `annotations.py`, `history.py`, `save.py`.

| Endpoint | Purpose |
|---|---|
| `GET /v1/docs/{id}/annotations?page=` | `[{ annotId, page, type, rect, quads?, color, opacity, contents, author, createdAt, modifiedAt }]`. Without `page`, returns all (for the comments panel) |
| `POST /v1/docs/{id}/annotations` | Create. Body by type: `highlight` / `underline` / `strikeout` take `{ page, quads, color }`; `note` takes `{ page, point, contents, color }` |
| `PATCH /v1/docs/{id}/annotations/{annotId}` | Change `contents`, `color`, `opacity`, `rect` (move) |
| `DELETE /v1/docs/{id}/annotations/{annotId}` | Delete |
| `POST /v1/docs/{id}/undo`, `/redo` | Returns the mutation response plus `{ canUndo, canRedo, undoName, redoName }` |
| `POST /v1/docs/{id}/save` `{ path? }` | Save to the original path, or to `path` for Save As |
| `GET /v1/docs/{id}/state` | `{ revision, savedRevision, canUndo, canRedo }` |

Notes:

- Text markup uses `page.add_highlight_annot(quads)` and the underline/strikeout equivalents; notes use `page.add_text_annot`. Set author from the configured user name (`annot.set_info`) and call `annot.update()`.
- `annotId` is the annotation's xref, which is stable within a session.
- **Saving** writes a full file to a temporary name in the destination folder, then replaces the target atomically (`os.replace`). On failure the original is untouched and the error is reported (file locked by another program, read-only, disk full).
- Save uses `garbage=3, deflate=True` to keep files tidy. Incremental save is not used, because later features (redaction, encryption) are incompatible with it and a single code path is simpler.
- If the document was opened with a password, saving preserves the existing encryption settings.
- **Recovery copy:** while a document has unsaved changes, the engine writes it to the app-data recovery folder every two minutes and on engine shutdown. It is deleted on save or clean close.

## Renderer

`viewer/AnnotationLayer` — per page, above the text layer. Draws nothing for the annotations themselves (they are part of the engine-rendered image); it provides hit areas, selection outlines, drag handles and the note pop-up.

`tools/`

- **Select** (default): text selection as in phase 2; clicking an annotation selects it.
- **Highlight / Underline / Strikeout:** either select text first and press the tool (or its shortcut), or arm the tool and drag across text. The selection is converted to quads from the text layer's word boxes, merged per line. A small floating toolbar appears on text selection with the three markup buttons, colour and "add comment".
- **Note:** click anywhere to drop a note and type its text.
- Selected annotation: floating toolbar with colour, comment, delete; Delete key removes; notes can be dragged.

`panels/Comments` — all annotations that have text, plus all notes, grouped by page; shows author and time; click to jump and select; edit and delete in place; filter by type.

Shell

- Edit menu and toolbar: Undo (Ctrl+Z), Redo (Ctrl+Y / Ctrl+Shift+Z).
- File: Save (Ctrl+S), Save As (Ctrl+Shift+S). Modified tabs show a dot; closing a modified tab or quitting asks Save / Don't Save / Cancel.
- Settings: author name for comments (defaults to the Windows user name), default highlight colour.
- On start, if recovery copies exist, offer to restore them.
- Rotation from phase 2 now goes through the same pipeline, so it is undoable and saved.

## Tests

Engine: creating each annotation type and reading it back; annotations survive save and reopen with content, colour and author; undo removes and redo restores an annotation and reports correct `canUndo`/`canRedo`; a sequence of mixed operations undoes in reverse order; save to a locked path fails cleanly and leaves the original intact; Save As writes the new file and updates the session path; an encrypted document stays encrypted after save; recovery copy is written and removed.

Renderer: selection-to-quads merging (single line, multi-line, across rotated pages); tools store; modified-state tracking against `savedRevision`.

## Verification

- Highlight, underline and strike out text on several pages; colours match the picker.
- Add notes and comments; they appear in the comments panel and jump correctly.
- Undo back to the original state and redo forward again.
- Save, close, reopen: everything persists. Open the saved file in Edge and in Adobe Reader and confirm highlights and comments show there too.
- Try to save while the file is open in another program that locks it: clear error, no data loss.
- Kill the app with unsaved changes; on restart the recovery offer restores them.

## Done when

Annotation, undo/redo and save are dependable, the saved files are valid in other PDF readers, and all tests pass.
