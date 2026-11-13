import { memo, useEffect, useRef, useState } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import type { Annotation, Rect } from '@/api/engine'
import {
  addNote,
  changeAnnotation,
  deleteAnnotation,
  editComment,
  selectAnnotation
} from '@/state/edits'
import { PALETTE, useTools } from '@/state/tools'
import { annotationAt, isMarkup } from '@/tools/hitTest'
import { cssScale, quadBounds, rectToPx, type PxBox } from './geometry'
import { usePageAnnotations } from './hooks'

/** A press that moves less than this (CSS px) is a click, not a drag. */
const CLICK_SLOP = 4
const TOOLBAR_HEIGHT = 34
const TOOLBAR_WIDTH = 252
const EDITOR_WIDTH = 248
const EDITOR_HEIGHT = 168
/** A new note's icon is centred on the click. */
const NOTE_HALF = 9
/** Elements of the layer that handle the pointer themselves. */
const OWN_CONTROLS = '.pdf-annotation-toolbar, .pdf-comment-editor, .pdf-annotation-hit'

interface AnnotationLayerProps {
  tabId: string
  docId: string
  page: number
  revision: number
  zoom: number
  /** Page size in points. */
  width: number
  height: number
  /** The selected annotation, if it is on this page. */
  selectedId: number | null
}

function outlineBoxes(
  annotation: Annotation,
  zoom: number,
  offset: { x: number; y: number }
): PxBox[] {
  if (isMarkup(annotation)) {
    return (annotation.quads ?? []).map((quad) => rectToPx(quadBounds(quad), zoom))
  }
  const box = rectToPx(annotation.rect, zoom)
  return [{ ...box, left: box.left + offset.x, top: box.top + offset.y }]
}

function unionBox(boxes: PxBox[]): PxBox {
  const left = Math.min(...boxes.map((box) => box.left))
  const top = Math.min(...boxes.map((box) => box.top))
  const right = Math.max(...boxes.map((box) => box.left + box.width))
  const bottom = Math.max(...boxes.map((box) => box.top + box.height))
  return { left, top, width: right - left, height: bottom - top }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Colour, comment and delete for the selected annotation. */
function AnnotationToolbar({
  tabId,
  annotation,
  box,
  pageWidth
}: {
  tabId: string
  annotation: Annotation
  box: PxBox
  pageWidth: number
}): React.JSX.Element {
  const target = { annotId: annotation.annotId, page: annotation.page }
  const above = box.top - TOOLBAR_HEIGHT - 6
  const top = above >= 0 ? above : box.top + box.height + 6
  const left = clamp(box.left, 4, pageWidth - TOOLBAR_WIDTH - 4)
  return (
    <div
      role="toolbar"
      aria-label="Annotation"
      className="pdf-annotation-toolbar"
      style={{ top, left }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {PALETTE.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          title={swatch.label}
          aria-label={`Colour: ${swatch.label}`}
          aria-pressed={annotation.color === swatch.value}
          className="pdf-swatch"
          style={{ background: swatch.value }}
          onClick={() => void changeAnnotation(tabId, target, { color: swatch.value })}
        />
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <button
        type="button"
        title="Comment"
        aria-label="Comment"
        className="pdf-annotation-button"
        onClick={() => editComment(tabId, target)}
      >
        <MessageSquare className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        title="Delete (Del)"
        aria-label="Delete"
        className="pdf-annotation-button"
        onClick={() => void deleteAnnotation(tabId, target)}
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/** The pop-up for reading and editing an annotation's comment. */
function CommentEditor({
  tabId,
  annotation,
  box,
  pageWidth,
  pageHeight
}: {
  tabId: string
  annotation: Annotation
  box: PxBox
  pageWidth: number
  pageHeight: number
}): React.JSX.Element {
  const [text, setText] = useState(annotation.contents)
  const ref = useRef<HTMLTextAreaElement>(null)
  const closed = useRef(false)
  const target = { annotId: annotation.annotId, page: annotation.page }

  useEffect(() => {
    ref.current?.focus()
    ref.current?.setSelectionRange(text.length, text.length)
    // Only when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = (save: boolean): void => {
    if (closed.current) return
    closed.current = true
    if (save && text !== annotation.contents) {
      void changeAnnotation(tabId, target, { contents: text })
    }
    useTools.getState().setEditing(null)
  }

  const right = box.left + box.width + 8
  const left =
    right + EDITOR_WIDTH <= pageWidth ? right : clamp(box.left, 4, pageWidth - EDITOR_WIDTH - 4)
  const top =
    right + EDITOR_WIDTH <= pageWidth
      ? clamp(box.top, 4, pageHeight - EDITOR_HEIGHT - 4)
      : clamp(box.top + box.height + 8, 4, pageHeight - EDITOR_HEIGHT - 4)

  return (
    <div
      className="pdf-comment-editor"
      style={{ left, top, width: EDITOR_WIDTH }}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        // Leaving the pop-up altogether saves; moving between its parts does not.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(true)
      }}
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-neutral-500">
        <span className="truncate font-medium text-neutral-700">
          {annotation.author || 'Comment'}
        </span>
        <span className="shrink-0">{formatDate(annotation.modifiedAt)}</span>
      </div>
      <textarea
        ref={ref}
        value={text}
        aria-label="Comment"
        placeholder="Add a comment…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close(false)
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            close(true)
          }
        }}
      />
      <div className="flex justify-end gap-1.5">
        <button type="button" className="pdf-editor-button" onClick={() => close(false)}>
          Cancel
        </button>
        <button type="button" className="pdf-editor-button primary" onClick={() => close(true)}>
          Save
        </button>
      </div>
    </div>
  )
}

/**
 * The annotations of one page, above the text layer. The annotations
 * themselves are part of the page image the engine renders; this layer only
 * adds what is needed to work with them: hit areas for notes, the outline
 * and toolbar of the selected annotation, dragging notes and the comment
 * pop-up. Text markup has no hit area of its own, so text under it can still
 * be selected; a click on it is hit-tested instead.
 */
export const AnnotationLayer = memo(function AnnotationLayer({
  tabId,
  docId,
  page,
  revision,
  zoom,
  width,
  height,
  selectedId
}: AnnotationLayerProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const fetched = usePageAnnotations(docId, page, revision, true)
  // While a changed page's annotations load, keep showing the previous ones.
  const [kept, setKept] = useState<Annotation[]>([])
  if (fetched && fetched !== kept) setKept(fetched)
  const annotations = fetched ?? kept
  const tool = useTools((state) => state.activeTool)
  const editing = useTools((state) => state.editing)
  const [drag, setDrag] = useState<{ annotId: number; x: number; y: number } | null>(null)

  /** What the page's own listeners work with. */
  const latest = useRef({ annotations, tool, zoom })
  useEffect(() => {
    latest.current = { annotations, tool, zoom }
  })

  // Clicks on the page (not on a note): select markup, deselect, or drop a note.
  useEffect(() => {
    const pageElement = ref.current?.parentElement
    if (!pageElement) return
    let down: { x: number; y: number } | null = null

    const onDown = (event: PointerEvent): void => {
      down = null
      if (event.button !== 0) return
      // The layer's own controls handle their presses. (React's
      // stopPropagation does not reach this native listener.)
      if (event.target instanceof Element && event.target.closest(OWN_CONTROLS)) return
      down = { x: event.clientX, y: event.clientY }
      // With the note tool a press must not start a text selection.
      if (latest.current.tool === 'note') event.preventDefault()
    }
    const onUp = (event: PointerEvent): void => {
      const start = down
      down = null
      if (!start || event.button !== 0) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return
      const selection = document.getSelection()
      if (selection && !selection.isCollapsed) return

      const bounds = pageElement.getBoundingClientRect()
      const scale = cssScale(latest.current.zoom)
      const point = {
        x: (event.clientX - bounds.left) / scale,
        y: (event.clientY - bounds.top) / scale
      }
      if (latest.current.tool === 'note') {
        void addNote(tabId, page, [point.x - NOTE_HALF, point.y - NOTE_HALF])
        return
      }
      const hit = annotationAt(latest.current.annotations, point)
      selectAnnotation(tabId, hit ? { annotId: hit.annotId, page } : null)
    }
    pageElement.addEventListener('pointerdown', onDown)
    pageElement.addEventListener('pointerup', onUp)
    return () => {
      pageElement.removeEventListener('pointerdown', onDown)
      pageElement.removeEventListener('pointerup', onUp)
    }
  }, [tabId, page])

  const pageWidth = width * cssScale(zoom)
  const pageHeight = height * cssScale(zoom)
  const selected = annotations.find((annotation) => annotation.annotId === selectedId) ?? null
  const offset =
    drag && selected && drag.annotId === selected.annotId
      ? { x: drag.x, y: drag.y }
      : { x: 0, y: 0 }
  const selectedBoxes = selected ? outlineBoxes(selected, zoom, offset) : []
  const selectedBox = selectedBoxes.length > 0 ? unionBox(selectedBoxes) : null
  const editingHere =
    editing && editing.tabId === tabId && editing.page === page
      ? (annotations.find((annotation) => annotation.annotId === editing.annotId) ?? null)
      : null

  const startDrag = (event: React.PointerEvent<HTMLElement>, annotation: Annotation): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const element = event.currentTarget
    const origin = { x: event.clientX, y: event.clientY }
    selectAnnotation(tabId, { annotId: annotation.annotId, page })
    const movable = annotation.type === 'note' && tool === 'select'
    element.setPointerCapture(event.pointerId)
    let moved = { x: 0, y: 0 }

    const onMove = (move: PointerEvent): void => {
      if (!movable) return
      moved = { x: move.clientX - origin.x, y: move.clientY - origin.y }
      if (Math.hypot(moved.x, moved.y) > CLICK_SLOP) {
        setDrag({ annotId: annotation.annotId, ...moved })
      }
    }
    const onUp = (): void => {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
      setDrag(null)
      const target = { annotId: annotation.annotId, page }
      if (movable && Math.hypot(moved.x, moved.y) > CLICK_SLOP) {
        const scale = cssScale(zoom)
        const [x0, y0, x1, y1] = annotation.rect
        const dx = moved.x / scale
        const dy = moved.y / scale
        const rect: Rect = [x0 + dx, y0 + dy, x1 + dx, y1 + dy]
        void changeAnnotation(tabId, target, { rect })
      } else if (annotation.type === 'note') {
        editComment(tabId, target)
      }
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
  }

  return (
    <div ref={ref} className="pdf-annotation-layer" data-page-index={page}>
      {annotations
        .filter((annotation) => !isMarkup(annotation))
        .map((annotation) => (
          <div
            key={annotation.annotId}
            className={cn('pdf-annotation-hit', annotation.type === 'note' && 'note')}
            style={rectToPx(annotation.rect, zoom)}
            title={annotation.contents || undefined}
            data-annot-id={annotation.annotId}
            onPointerDown={(event) => startDrag(event, annotation)}
            onDoubleClick={() =>
              editComment(tabId, { annotId: annotation.annotId, page: annotation.page })
            }
          />
        ))}
      {selectedBoxes.map((box, index) => (
        <div key={index} className="pdf-annotation-selected" style={box} />
      ))}
      {selected && selectedBox && !drag && editingHere?.annotId !== selected.annotId && (
        <AnnotationToolbar
          tabId={tabId}
          annotation={selected}
          box={selectedBox}
          pageWidth={pageWidth}
        />
      )}
      {editingHere && (
        <CommentEditor
          key={editingHere.annotId}
          tabId={tabId}
          annotation={editingHere}
          box={unionBox(outlineBoxes(editingHere, zoom, { x: 0, y: 0 }))}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
        />
      )}
    </div>
  )
})
