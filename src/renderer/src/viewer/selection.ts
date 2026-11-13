/**
 * Text selection across the text layers.
 *
 * The layers consist of absolutely positioned spans, which the browser can
 * select natively. Two things need help:
 *
 * 1. While the pointer is over empty space between lines, Chromium extends
 *    the selection to the end of the layer, so the selection flashes over the
 *    rest of the page. Each layer therefore has an "end of content" element
 *    that is moved next to the end of the selection being dragged; the jump
 *    is then limited to the span the pointer just left. (The same approach
 *    pdf.js uses.)
 *
 * 2. Copying. The text put on the clipboard is assembled from the selected
 *    spans, so that words are separated by spaces and lines by line breaks
 *    regardless of how the spans happen to be laid out.
 */

import type { Rect } from '@/api/engine'
import type { WordPiece } from '@/tools/quads'

export const TEXT_LAYER_CLASS = 'pdf-text-layer'
export const END_OF_CONTENT_CLASS = 'end-of-content'
const SELECTING_CLASS = 'selecting'
/** Set on the last span of each line. */
export const END_OF_LINE_ATTRIBUTE = 'data-eol'

/** Every mounted text layer and its end-of-content element. */
const layers = new Map<HTMLElement, HTMLElement>()

/** Which word each span of a text layer shows. */
export interface SpanWord {
  page: number
  line: number
  angle: number
  bbox: Rect
  /** Characters of the span's text that belong to the word. */
  length: number
}

const spanWords = new WeakMap<Element, SpanWord>()

/** Records which word a text layer span shows, for turning selections into markup. */
export function describeSpan(span: Element, word: SpanWord): void {
  spanWords.set(span, word)
}

/** Text layers that take part in `range`, in document (page) order. */
function layersIn(range: Range): HTMLElement[] {
  return [...layers.keys()]
    .filter((layer) => range.intersectsNode(layer))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
}

/** The selected part (character offsets) of a span's text. */
function selectedPart(range: Range, span: Element, node: Node): [number, number] {
  const content = node.textContent ?? ''
  // A boundary is normally inside the span's text. It can also sit on the
  // span itself, before (offset 0) or after its text.
  let from = 0
  if (range.startContainer === node) from = range.startOffset
  else if (range.startContainer === span && range.startOffset > 0) from = content.length
  let to = content.length
  if (range.endContainer === node) to = range.endOffset
  else if (range.endContainer === span && range.endOffset === 0) to = 0
  return [from, to]
}

/**
 * The words the selection covers, with the selected part of each, for
 * creating text markup. Empty if nothing on a page is selected.
 */
export function selectedWordPieces(selection: Selection | null): WordPiece[] {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return []
  const range = selection.getRangeAt(0)
  const pieces: WordPiece[] = []
  for (const layer of layersIn(range)) {
    for (const child of layer.children) {
      const word = spanWords.get(child)
      const node = child.firstChild
      if (!word || !node || !range.intersectsNode(child) || word.length <= 0) continue
      const [from, to] = selectedPart(range, child, node)
      if (to <= from || from >= word.length) continue
      pieces.push({
        page: word.page,
        line: word.line,
        angle: word.angle,
        bbox: word.bbox,
        from: from / word.length,
        to: Math.min(to, word.length) / word.length
      })
    }
  }
  return pieces
}

/** Ends any text selection. */
export function clearTextSelection(): void {
  document.getSelection()?.removeAllRanges()
}
let installed = 0
let previousRange: Range | null = null

function reset(layer: HTMLElement, end: HTMLElement): void {
  if (end.parentElement !== layer || layer.lastElementChild !== end) layer.append(end)
  end.style.width = ''
  end.style.height = ''
  end.style.userSelect = ''
  layer.classList.remove(SELECTING_CLASS)
}

function resetAll(): void {
  for (const [layer, end] of layers) reset(layer, end)
}

function onSelectionChange(): void {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    resetAll()
    previousRange = null
    return
  }

  const range = selection.getRangeAt(0)
  for (const [layer, end] of layers) {
    if (range.intersectsNode(layer)) layer.classList.add(SELECTING_CLASS)
    else reset(layer, end)
  }

  // Which end of the selection is the user moving?
  const movingStart =
    previousRange !== null &&
    (range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0)

  let anchor: Node | null = movingStart ? range.startContainer : range.endContainer
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
  if (!movingStart && range.endOffset === 0) {
    // The selection ends before the first character of a span: the span it
    // really ends in is the previous one.
    while (anchor && !anchor.previousSibling) anchor = anchor.parentNode
    anchor = anchor?.previousSibling ?? null
  }

  const span = anchor instanceof HTMLElement ? anchor : null
  const layer = span?.parentElement
  const end = layer ? layers.get(layer) : undefined
  if (span && layer && end && span !== end) {
    end.style.width = layer.style.width
    end.style.height = layer.style.height
    end.style.userSelect = 'text'
    layer.insertBefore(end, movingStart ? span : span.nextSibling)
  }
  previousRange = range.cloneRange()
}

/** The selected text of the text layers, or `null` if the selection is elsewhere. */
export function selectedLayerText(selection: Selection | null): string | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)

  let text = ''
  let lineBreakDue = false
  let found = false
  // Layers are visited in document order, which is page order.
  for (const layer of layersIn(range)) {
    for (const child of layer.children) {
      if (child.classList.contains(END_OF_CONTENT_CLASS)) continue
      const node = child.firstChild
      if (!node || !range.intersectsNode(child)) continue
      found = true

      const content = node.textContent ?? ''
      const [from, to] = selectedPart(range, child, node)
      const part = content.slice(from, to)
      if (part.length > 0) {
        if (lineBreakDue) text = `${text.trimEnd()}\n`
        lineBreakDue = false
        text += part
      }
      // A line ends here if its last span is selected to the end.
      if (child.hasAttribute(END_OF_LINE_ATTRIBUTE) && to === content.length && text.length > 0) {
        lineBreakDue = true
      }
    }
    // The next page starts on a new line.
    if (text.length > 0) lineBreakDue = true
  }
  return found ? text.trimEnd() : null
}

function onCopy(event: ClipboardEvent): void {
  const text = selectedLayerText(document.getSelection())
  if (text === null || !event.clipboardData) return
  event.clipboardData.setData('text/plain', text)
  event.preventDefault()
}

/** Makes a text layer take part in selection handling. Returns the undo. */
export function registerTextLayer(layer: HTMLElement, end: HTMLElement): () => void {
  layers.set(layer, end)
  return () => {
    layers.delete(layer)
  }
}

/** Installs the document-wide listeners. Returns a function that removes them. */
export function installSelectionHandling(): () => void {
  installed += 1
  if (installed === 1) {
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerup', resetAll)
    document.addEventListener('copy', onCopy)
  }
  return () => {
    installed -= 1
    if (installed === 0) {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerup', resetAll)
      document.removeEventListener('copy', onCopy)
      previousRange = null
    }
  }
}
