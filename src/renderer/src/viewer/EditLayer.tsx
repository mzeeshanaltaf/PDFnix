import { memo, useRef, useState } from 'react'
import type { Rect, TextBlock } from '@/api/engine'
import { mutate } from '@/state/edits'
import { markArea } from '@/state/redaction'
import { commitPending, startPending, usePending } from '@/state/pending'
import { useSignatures } from '@/state/signatures'
import { isEditTool, useTools } from '@/state/tools'
import { blockStyle } from '@/tools/blockStyle'
import { placeImage } from '@/tools/images'
import { engine } from '@/api/engine'
import { getViewer } from './controller'
import { lineEnd, rectFromDrag, smoothStroke } from './editGeometry'
import { TEXT_LINE_HEIGHT } from './editDom'
import { EditOverlay } from './EditOverlay'
import { cssScale, rectToPx, type Point } from './geometry'
import { usePageBlocks, usePageCount } from './hooks'

/** A press that moves less than this (points) is a click. */
const CLICK_SLOP_PT = 3
/** Width of a text box made by clicking. */
const CLICK_TEXT_WIDTH = 200
/** Width signatures and initials are placed at. */
const SIGNATURE_WIDTH = 150
const INITIALS_WIDTH = 50

interface EditLayerProps {
  tabId: string
  docId: string
  page: number
  revision: number
  zoom: number
  /** Page size in points. */
  width: number
  height: number
}

function inside(rect: Rect, point: Point): boolean {
  return point.x >= rect[0] && point.x <= rect[2] && point.y >= rect[1] && point.y <= rect[3]
}

function area(rect: Rect): number {
  return (rect[2] - rect[0]) * (rect[3] - rect[1])
}

/** The text block or image under a point; text first, smallest first. */
function objectAt(
  blocks: TextBlock[],
  images: { bbox: Rect }[],
  point: Point,
  withImages: boolean
): { kind: 'text'; block: TextBlock } | { kind: 'image'; bbox: Rect } | null {
  const block = blocks
    .filter((candidate) => inside(candidate.bbox, point))
    .sort((a, b) => area(a.bbox) - area(b.bbox))[0]
  if (block) return { kind: 'text', block }
  if (!withImages) return null
  const image = images
    .filter((candidate) => inside(candidate.bbox, point))
    .sort((a, b) => area(a.bbox) - area(b.bbox))[0]
  return image ? { kind: 'image', bbox: image.bbox } : null
}

/**
 * Above the annotation layer: while an edit tool is armed it takes the
 * pointer, so a press creates a text box, shape or drawing, picks text to
 * edit or an object to delete, places a signature, or pans. It also holds the
 * pending object's overlay when that is on this page.
 */
export const EditLayer = memo(function EditLayer({
  tabId,
  docId,
  page,
  revision,
  zoom,
  width,
  height
}: EditLayerProps): React.JSX.Element | null {
  const tool = useTools((state) => state.activeTool)
  const pending = usePending((state) =>
    state.pending && state.pending.tabId === tabId && state.pending.page === page
      ? state.pending
      : null
  )
  const pageCount = usePageCount(tabId)
  const pickingObjects = tool === 'editText' || tool === 'deleteObject'
  const blocks = usePageBlocks(docId, page, revision, pickingObjects)
  const [hover, setHover] = useState<Rect | null>(null)
  const [draft, setDraft] = useState<Rect | null>(null)
  const [redactDraft, setRedactDraft] = useState<Rect | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const scale = cssScale(zoom)
  const active = isEditTool(tool)

  const pointOf = (event: { clientX: number; clientY: number }): Point => {
    const bounds = surface.current?.getBoundingClientRect()
    return {
      x: (event.clientX - (bounds?.left ?? 0)) / scale,
      y: (event.clientY - (bounds?.top ?? 0)) / scale
    }
  }

  /** Follows a drag on the surface in page points. */
  const follow = (
    event: React.PointerEvent<HTMLDivElement>,
    onMove: (point: Point, pointer: PointerEvent) => void,
    onEnd: (point: Point, pointer: PointerEvent) => void
  ): void => {
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const move = (pointer: PointerEvent): void => onMove(pointOf(pointer), pointer)
    const end = (pointer: PointerEvent): void => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', end)
      element.removeEventListener('pointercancel', end)
      onEnd(pointOf(pointer), pointer)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', end)
    element.addEventListener('pointercancel', end)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const start = pointOf(event)
    const tools = useTools.getState()
    const current = usePending.getState().pending
    const sameInk =
      tool === 'draw' &&
      current?.tabId === tabId &&
      current.page === page &&
      current.object.kind === 'ink'
    if (!sameInk && current) void commitPending()

    switch (tool) {
      case 'hand': {
        let last = { x: event.clientX, y: event.clientY }
        const element = event.currentTarget
        element.setPointerCapture(event.pointerId)
        const move = (pointer: PointerEvent): void => {
          getViewer(tabId)?.scrollByPixels(last.x - pointer.clientX, last.y - pointer.clientY)
          last = { x: pointer.clientX, y: pointer.clientY }
        }
        const end = (): void => {
          element.removeEventListener('pointermove', move)
          element.removeEventListener('pointerup', end)
        }
        element.addEventListener('pointermove', move)
        element.addEventListener('pointerup', end)
        return
      }
      case 'text':
        follow(
          event,
          (point) => setDraft(rectFromDrag(start, point)),
          (point) => {
            setDraft(null)
            const style = tools.text
            const lineHeight = style.fontSize * TEXT_LINE_HEIGHT + 2
            const dragged = rectFromDrag(start, point)
            const rect: Rect =
              Math.hypot(point.x - start.x, point.y - start.y) < CLICK_SLOP_PT
                ? [
                    start.x,
                    start.y - lineHeight / 2,
                    Math.min(width, start.x + CLICK_TEXT_WIDTH),
                    start.y + lineHeight / 2
                  ]
                : [
                    dragged[0],
                    dragged[1],
                    dragged[2],
                    Math.max(dragged[3], dragged[1] + lineHeight)
                  ]
            startPending({
              tabId,
              page,
              object: { kind: 'text', rect, text: '', style, rotation: 0 }
            })
          }
        )
        return
      case 'shape': {
        const options = tools.shape
        const isLine = options.kind === 'line' || options.kind === 'arrow'
        const shapeOf = (point: Point, square: boolean): void => {
          if (isLine) {
            const end = lineEnd(start, point, square)
            usePending.getState().set({
              tabId,
              page,
              object: {
                kind: 'line',
                points: [start, end],
                arrow: options.kind === 'arrow',
                style: options
              }
            })
          } else {
            usePending.getState().set({
              tabId,
              page,
              object: {
                kind: 'shape',
                shape: options.kind === 'circle' ? 'circle' : 'square',
                rect: rectFromDrag(start, point, square),
                style: options
              }
            })
          }
        }
        follow(
          event,
          (point, pointer) => shapeOf(point, pointer.shiftKey),
          (point) => {
            // A click (no drag) makes nothing.
            if (Math.hypot(point.x - start.x, point.y - start.y) < CLICK_SLOP_PT) {
              usePending.getState().set(null)
            }
          }
        )
        return
      }
      case 'draw': {
        const stroke: Point[] = [start]
        const base =
          sameInk && current?.object.kind === 'ink' ? current.object.strokes : ([] as Point[][])
        const show = (): void =>
          usePending.getState().set({
            tabId,
            page,
            object: { kind: 'ink', strokes: [...base, [...stroke]], style: tools.pen }
          })
        show()
        follow(
          event,
          (point) => {
            stroke.push(point)
            show()
          },
          () => {
            const smooth = smoothStroke(stroke)
            usePending.getState().set({
              tabId,
              page,
              object: { kind: 'ink', strokes: [...base, smooth], style: tools.pen }
            })
          }
        )
        return
      }
      case 'signature': {
        const { placing, entries } = useSignatures.getState()
        const entry = entries.find((candidate) => candidate.id === placing?.entryId)
        if (!entry) {
          tools.setActiveTool('select')
          return
        }
        tools.setActiveTool('select')
        useSignatures.getState().setPlacing(null)
        placeImage(
          tabId,
          page,
          { data: entry.png, width: entry.width, height: entry.height },
          {
            label: entry.kind === 'signature' ? 'Signature' : 'Initials',
            center: start,
            maxWidth: entry.kind === 'signature' ? SIGNATURE_WIDTH : INITIALS_WIDTH
          }
        )
        if (placing?.allPages) {
          const pages = Array.from({ length: pageCount }, (_, index) => index).filter(
            (index) => index !== page
          )
          usePending
            .getState()
            .update((object) => (object.kind === 'image' ? { ...object, pages } : object))
        }
        return
      }
      case 'redact':
        follow(
          event,
          (point) => setRedactDraft(rectFromDrag(start, point)),
          (point) => {
            setRedactDraft(null)
            // A click (no drag) marks nothing.
            if (Math.hypot(point.x - start.x, point.y - start.y) < CLICK_SLOP_PT) return
            const rect = rectFromDrag(start, point)
            const clamped: Rect = [
              Math.max(0, rect[0]),
              Math.max(0, rect[1]),
              Math.min(width, rect[2]),
              Math.min(height, rect[3])
            ]
            if (clamped[2] - clamped[0] < 1 || clamped[3] - clamped[1] < 1) return
            void markArea(tabId, page, clamped)
          }
        )
        return
      case 'editText':
      case 'deleteObject': {
        if (!blocks) return
        const hit = objectAt(blocks.blocks, blocks.images, start, tool === 'deleteObject')
        if (!hit) return
        setHover(null)
        if (tool === 'deleteObject') {
          const bbox = hit.kind === 'text' ? hit.block.bbox : hit.bbox
          void mutate(
            tabId,
            (id) => engine.deleteObject(id, page, bbox, hit.kind),
            hit.kind === 'text' ? 'Could not delete the text' : 'Could not delete the image'
          )
          return
        }
        if (hit.kind !== 'text') return
        const { style, fontName } = blockStyle(hit.block)
        startPending({
          tabId,
          page,
          object: {
            kind: 'editText',
            rect: hit.block.bbox,
            original: hit.block.text,
            text: hit.block.text,
            style,
            originalStyle: style,
            fontName,
            rotation: hit.block.angle
          }
        })
        return
      }
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!pickingObjects || !blocks || event.buttons !== 0) return
    const hit = objectAt(blocks.blocks, blocks.images, pointOf(event), tool === 'deleteObject')
    const rect = hit ? (hit.kind === 'text' ? hit.block.bbox : hit.bbox) : null
    setHover((previous) => (previous?.join() === rect?.join() ? previous : rect))
  }

  if (!active && !pending) return null

  // The block being edited is not offered again while its editor is open.
  const editing = pending?.object.kind === 'editText' ? pending.object.rect : null

  return (
    <div className="pdf-edit-layer" data-page-index={page}>
      {active && (
        <div
          ref={surface}
          data-edit-surface
          className={`pdf-edit-surface tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        />
      )}
      {hover && hover.join() !== editing?.join() && (
        <div
          className={`pdf-edit-hover ${tool === 'deleteObject' ? 'delete' : ''}`}
          style={rectToPx(hover, zoom)}
        />
      )}
      {draft && <div className="pdf-edit-draft" style={rectToPx(draft, zoom)} />}
      {redactDraft && <div className="pdf-redact-draft" style={rectToPx(redactDraft, zoom)} />}
      {pending && (
        <EditOverlay
          pending={pending}
          zoom={zoom}
          pageWidth={width}
          pageHeight={height}
          pageCount={pageCount}
          passive={tool === 'draw' && pending.object.kind === 'ink'}
        />
      )}
    </div>
  )
})
