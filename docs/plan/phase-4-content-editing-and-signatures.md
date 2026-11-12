# Phase 4 — Content Editing and Signatures

**Goal:** the user can change the page content itself: add text, images, shapes and freehand drawing, edit or delete existing text, and place signatures and initials.

**Depends on:** phases 1–3 (edit pipeline, undo/redo and save from [phase-3-annotations-and-save.md](phase-3-annotations-and-save.md)).

## Scope

Included: add text box, add image, shapes (rectangle, ellipse, line, arrow), freehand ink, edit existing text, delete existing text or images, signature and initials library and placement.

Not included: paragraph reflow, certificate-based digital signatures.

## Interaction model

A newly added object lives in a renderer overlay (`viewer/EditOverlay`) where it can be moved, resized, rotated in 90° steps and restyled. It is **committed** to the page when the user clicks elsewhere, presses Enter/Escape as appropriate, switches tool, or saves. Committing is one engine call and one undo step.

After commit:

- Shapes, ink and standalone text boxes are stored as PDF **annotations** (square, circle, line, ink, free text), so they stay selectable, movable and deletable later through the phase 3 annotation layer, and other PDF readers treat them as editable too.
- Images and signatures are written into the **page content**. They can be removed with undo, or later with the "delete object" tool.
- Edits to existing text change the page content.

## Engine

New modules: `edit.py`, `fonts.py`; `annotations.py` extended.

| Endpoint | Purpose |
|---|---|
| `POST /v1/docs/{id}/annotations` (extended) | New types: `freetext` `{ page, rect, text, fontFamily, fontSize, color, align }`, `square`, `circle`, `line` (with optional arrow ends), `ink` `{ strokes }`; all with stroke colour, fill, width, opacity |
| `GET /v1/docs/{id}/pages/{n}/blocks` | Editable text blocks: `[{ blockId, bbox, text, lines: [{ bbox, spans: [{ text, font, size, color, flags }] }] }]` from `page.get_text("dict")`; plus image objects `[{ imageId, bbox }]` |
| `POST /v1/docs/{id}/pages/{n}/text/replace` `{ bbox, text, fontFamily?, fontSize?, color?, align? }` | Replace the text inside `bbox` (empty `text` deletes it) |
| `POST /v1/docs/{id}/pages/{n}/images` (multipart) `{ rect, rotation }` + file | Insert an image into the page content, keeping transparency |
| `POST /v1/docs/{id}/pages/{n}/objects/delete` `{ bbox, kind }` | Remove an image or text region from the page content |
| `GET /v1/fonts` | Fonts available for new text: bundled fonts plus those found in the document |

**Replacing existing text** (`edit.py`):

1. Read the spans under `bbox` to learn font, size, colour and alignment.
2. Remove the old text: `page.add_redact_annot(bbox)` then `page.apply_redactions(...)` with options set so that images and vector graphics under the text are kept and no fill is painted.
3. Insert the new text with `page.insert_htmlbox(bbox, html, …)`, which shapes and wraps text and can shrink to fit. If the text is longer than the box allows at the original size, grow the box downward when there is free space below, otherwise shrink the font slightly and report that in the response.

**Font matching** (`fonts.py`):

- Try the document's embedded font (`doc.extract_font`). Subsetted fonts usually lack glyphs for characters not already in the document, so check that every character of the new text has a glyph.
- Otherwise fall back to a bundled font chosen by the original font's characteristics (serif / sans / mono, bold, italic). Bundle open-licensed families that are metric-compatible with the common ones (for example Liberation Sans/Serif/Mono for Arial/Times/Courier) plus Noto Sans for wide language coverage.
- The response says which font was used so the UI can show "font substituted".

Confirm the exact redaction option names and `insert_htmlbox` parameters against the pinned PyMuPDF version's documentation before writing this module.

## Renderer

`viewer/EditOverlay` — the pending object with move/resize handles and a floating properties bar. Shared by all tools below.

`tools/`

- **Add Text:** click or drag to create a box, type directly in it. Properties: font, size, colour, bold/italic, alignment.
- **Edit Text:** hovering outlines editable blocks (from `/blocks`). Clicking a block opens an editable box pre-filled with its text and style, positioned exactly over the original. Committing calls `/text/replace`. Clearing the text deletes the block. A notice appears when the font was substituted.
- **Add Image:** choose PNG/JPG/WebP/SVG or paste from the clipboard; place and resize with locked aspect ratio (Shift to unlock).
- **Shapes:** rectangle, ellipse, line, arrow; stroke colour, fill, width, opacity.
- **Draw:** freehand pen with colour and width, smoothed strokes; pen pressure is not needed.
- **Delete object:** click an image or text block in the page content to remove it.

**Signatures and initials** (`dialogs/Signature`, `tools/Signature`)

- Two separate libraries: signatures and initials. Each entry can be created three ways:
  - **Draw** on a canvas with mouse, pen or touch.
  - **Type** a name rendered in one of several bundled handwriting fonts.
  - **Upload** a photo or scan; the white background is removed with an adjustable threshold and the result is cropped to its ink.
- Entries are stored as transparent PNGs in the app-data folder. They can be renamed, deleted, and one marked as default.
- Toolbar "Sign" menu: pick a signature or initials, then click to place. It appears in the edit overlay, sized sensibly for the page, and is committed through the image endpoint.
- "Place initials on every page" puts the chosen initials at the same position on a page range as a single undo step.
- An optional date stamp can be placed next to a signature as a text box.
- These are visual signatures. The dialog states that they are not certificate-based digital signatures.

## Tests

Engine: free text, shape and ink annotations round-trip through save and reopen; inserted PNG keeps its alpha channel and lands at the requested rectangle, including on rotated pages; replacing text removes the old string and the new string is extractable at roughly the same position; replacing text over a background image leaves the image intact; deleting text leaves no extractable remnant; font fallback is chosen when the embedded font lacks a glyph; each operation is one undo step.

Renderer: overlay geometry (move, resize, aspect lock) under zoom and rotation; background-removal function on sample images; signature library store.

## Verification

- Add a text box, an image, each shape and a drawing; move and restyle them; save and reopen in this app and in Adobe Reader.
- Edit a word in an ordinary document: surrounding content is unchanged and the new text looks consistent. Repeat on a document with subsetted fonts and confirm the substitution notice.
- Delete a paragraph and an image.
- Create a signature each way (draw, type, upload), place it, resize it, save. Place initials on all pages.
- Undo every kind of operation.
- Try all of the above on a page rotated by 90°.

## Risks

- **Text edit fidelity.** Font substitution and tight layouts mean edited text will not always be pixel-identical. This is expected at the agreed edit depth; the UI is honest about substitutions.
- **Complex pages.** Text drawn as vector outlines or inside images is not editable; the tool simply shows no block there (OCR in phase 6 does not make it editable either).

## Done when

All listed content edits work on ordinary documents, survive save and reopen in other readers, are undoable, and tests pass.
