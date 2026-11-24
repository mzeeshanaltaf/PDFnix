# Phase 8 — Selection Menu

**Goal:** when text is selected, show an Acrobat-style menu over it. The menu has a row of markup icons, then Copy text and Edit text. The same menu opens on right-click over selected text. This phase does not add AI items; phase 10 adds them to a section this phase reserves.

**Depends on:** phases 1–7 (shipped as v0.3.0).

## Background

Phases 8–10 add a text-selection menu and a local AI assistant running on LM Studio. The user asked for both on 2026-11-24, with an Adobe Acrobat screenshot as the model.

The screenshot shows a dark card under the selection:
- a row of icons: comment, highlight, underline, strikethrough, replace text, …;
- Copy text and Edit text;
- Simplify, Define and Ask AI Assistant.

The user chose these options for PDFnix:

| Topic | Decision |
|---|---|
| Icon row | PDFnix's own markup set: Comment, Highlight, Underline, Strikeout, Redact, plus the existing colour swatches. No "Replace text", "Add text" or "Share to WhatsApp" |
| AI answers | In a side-panel chat (phase 10), not inline |
| Models | **LM Studio only**, through its native `/api/v1` REST API, with the user picking the model (phase 9). Ollama was considered and dropped on 2026-11-24: the user's models are in LM Studio, and LM Studio's own API can set the context size per request |
| AI context | The current page by default, with an option for the whole document (phases 9–10) |

## Scope

Included:
- the menu replacing today's selection toolbar;
- right-click on selected text;
- Copy text;
- Edit text, started from a selection;
- keyboard and screen-reader basics;
- an empty extension point for phase 10.

Not included: AI items (phase 10), Replace text, Add text, sharing.

## What exists today

- `src/renderer/src/tools/SelectionToolbar.tsx` (mounted globally in `App.tsx`) is a fixed 286×36 bar. It shows only with the Select tool and holds Highlight, Underline, Strikeout, 5 colour swatches and "Add comment".
  - It appears on `pointerup`, or on `keyup` with Shift, after a `setTimeout(0)`.
  - If a markup tool is armed, releasing the mouse marks the text immediately instead.
  - It hides when the selection collapses, and moves on scroll and resize.
  - `onMouseDown={e => e.preventDefault()}` keeps the DOM selection alive while a button is pressed. **Every action reads the live selection, so this must stay.**
- The selection is the browser's own DOM selection over the text layer (`viewer/TextLayer.tsx`). Nothing is stored in a store. Helpers in `viewer/selection.ts`:
  - `selectedWordPieces(selection)` returns `{page, line, angle, bbox, from, to}[]`;
  - `selectedLayerText(selection)` returns the text with line breaks;
  - `clearTextSelection()`.
  - `tools/quads.ts` has `piecesToMarkup`.
- Actions:
  - `markSelection(tabId, kind, {color})` and `commentOnSelection(tabId, color)` are in `state/edits.ts`;
  - `markTextSelection(tabId)` is in `state/redaction.ts`;
  - `copyText(text, what)` is in `lib/clipboard.ts` (clipboard write + toast).
- Right-click on a page has no handler. The only context menu is in `panels/PageOrganiser.tsx`.
- Edit text starts only from a click with the Edit text tool. See the `editText` case in `viewer/EditLayer.tsx`: it hit-tests `pageBlocks` and calls `startPending({ kind: 'editText', rect, original, text, style, originalStyle, fontName, rotation })` with `blockStyle(block)` from `tools/blockStyle.ts`. Blocks come from the `pageBlocks` cache (`viewer/pageText.ts`, `request(docId, page, revision)`). The revision is `tab.pageRevisions[page] ?? tab.revision`.
- UI parts: `components/ui` has `button`, `context-menu`, `dropdown-menu`, `popover`, `separator`, `tooltip` and others. Icons come from `lucide-react`.

## Tasks

### 1. `SelectionMenu`

- Replace `tools/SelectionToolbar.tsx` with `tools/SelectionMenu.tsx`, mounted at the same place in `App.tsx`. Delete the old file.
- Keep all of the toolbar's event behaviour listed above, including the immediate marking with an armed markup tool and the mousedown `preventDefault`.
- Layout: a popover-coloured card, about 300 px wide, rounded, with a shadow.
  - **Icon row:**
    - Comment → `commentOnSelection`.
    - Highlight, Underline, Strikeout → `markSelection(tabId, kind, { color })`. Tooltips show the keys H / U / K.
    - Redact → `markTextSelection`.
    - A colour button at the end opens the 5 swatches (`PALETTE.slice(0, 5)`), as the toolbar has now. A picked colour applies to the next mark from the menu; otherwise each kind uses its tool's own colour, as today.
  - Separator.
  - **Copy text** → `copyText(selectedLayerText(document.getSelection()) ?? '')`.
  - **Edit text** → `editSelectedText(tabId)` (task 3).
  - **Extension point:** export `registerSelectionMenuSection(section)`, or a plain exported array, taking `{ id, items: { id, label, icon, run(context) }[] }`.
    - `context` is `{ tabId, text, page, pieces }`, captured **before** the menu closes or the selection is cleared.
    - Registered sections are drawn after a separator, and nothing is drawn while there are none.
    - Phase 10 registers the AI section here.
- Each action closes the menu first, as `act()` does now.

### 2. Placement, right-click and keyboard

- Placement is measured: render hidden, read `offsetHeight`, then position the card.
  - It goes below the last client rect of the selection, flipped above the first rect when it would cross the window's bottom (keep the 40 px status-bar margin).
  - It is clamped horizontally to the window with an 8 px margin.
  - Put the arithmetic in a pure function, `menuPlacement(rects, size, viewport)`, so it can be unit-tested.
- **Right-click:** add `onContextMenu` on the page list (`viewer/PageList.tsx`).
  - When `selectedWordPieces(document.getSelection()).length > 0`, call `preventDefault()` and open the menu with its top-left at the pointer (clamped).
  - Otherwise do nothing, so text boxes and other inputs keep their own behaviour.
- **Escape** closes the menu but keeps the selection. A second Escape follows the existing `edit.escape` behaviour.
- **Accessibility:**
  - The container is `role="menu"` with `aria-label="Selected text"`. Buttons are `role="menuitem"` with labels; the icon row is a `role="group"`.
  - Focus is **not** moved into the menu on open, so page shortcuts (H/U/K, Ctrl+C) keep working.
  - Tab from the page does not need to reach it.
  - `shortcuts.ts` ignores keys inside `[role=menu]`; check that this doesn't swallow keys while the menu is merely open.

### 3. Edit text from a selection

- Move the `startPending({ kind: 'editText', … })` block from `EditLayer.tsx` into `startTextEdit(tabId, page, block)` in `state/pending.ts`. `EditLayer` calls it.
- Add `editSelectedText(tabId)`:
  1. Take the first piece from `selectedWordPieces`.
  2. `await pageBlocks.request(docId, page, revision)`.
  3. Pick the block whose bbox contains the centre of the piece's bbox. If several do, take the smallest. Write this as a pure helper, `blockForPoint`.
  4. Arm the `editText` tool (`useTools`), clear the text selection, then `startTextEdit`.
- With no matching block (e.g. text inside an annotation, or no blocks), show the toast "This text can't be edited here" and leave the selection alone.

### 4. Help

- Add "Right-click selected text: selection menu" to `shell/shortcutReference.ts` in the appropriate group, keeping its test green. If the test only accepts keys `shortcutFor` resolves, add it as a note rather than a key binding.

## Tests

Renderer (vitest):
- `menuPlacement`: goes below the selection, flips above near the bottom, clamps left and right, and places a right-click menu at the pointer.
- `blockForPoint`: a point inside one block, overlapping blocks (smallest wins), no block.
- The section registry: no sections means no extra separator.

End-to-end (Playwright, new `tests/e2e/selection-menu.spec.ts`, using the existing fixtures and helpers):
- Select a word: the menu shows Comment, Highlight, Underline, Strikeout, Redact, Copy text and Edit text.
- Highlight from the menu creates a highlight; check it through the engine API, as the other specs do.
- Copy text puts the selected text on the clipboard.
- Edit text opens the edit overlay on the block that holds the selection.
- Right-click on the selection opens the menu; right-click with no selection does not.
- Escape closes the menu.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build && pnpm test:e2e`. Clear `ELECTRON_RUN_AS_NODE` first when running from VS Code (see STATUS.md).
- By hand in `pnpm dev`:
  - select text on a normal page, on a rotated (90°) page, near each window edge, and across two pages;
  - use every item;
  - check the colour choice;
  - check that Ctrl+C still copies while the menu is open;
  - check that H/U/K still mark the selection;
  - check that an armed markup tool still marks on release without showing the menu.

## Done when

The menu replaces the toolbar with every earlier function still available. Right-click and Edit text from a selection work. The extension point exists and is empty. All tests pass.
