/**
 * The object being placed or edited before it becomes part of the document:
 * a new text box, an edit of the page's own text, an image or signature, a
 * shape or a drawing. Only one exists at a time. It lives in the page's edit
 * overlay, where it can be moved, resized, turned and restyled, and is
 * committed to the document with one engine call (one undo step) when the
 * user clicks elsewhere, presses Enter or Escape as appropriate, switches tool
 * or tab, or saves.
 */

import { toast } from 'sonner'
import { create } from 'zustand'
import {
  engine,
  type Annotation,
  type FontFamily,
  type MutationResult,
  type Rect,
  type Rotation,
  type TextAlign,
  type TextReplaceResult
} from '../api/engine'
import { pointsBounds } from '../viewer/editGeometry'
import type { Point } from '../viewer/geometry'
import { mutate, selectAnnotation } from './edits'
import { useSettings } from './settings'
import { useTabs } from './tabs'
import {
  DEFAULT_TEXT,
  useTools,
  type PenOptions,
  type ShapeOptions,
  type TextOptions
} from './tools'

/** Style of an edit to the page's own text. `fontFamily` null keeps the original font. */
export interface EditTextStyle {
  fontFamily: FontFamily | null
  fontSize: number
  color: string
  bold: boolean
  italic: boolean
  align: TextAlign
}

export type PendingObject =
  | {
      kind: 'text'
      rect: Rect
      text: string
      style: TextOptions
      rotation: Rotation
      /** Set when an existing text box is being edited. */
      annotId?: number
      /** A fill colour the existing box has, kept as it is. */
      fill?: string | null
    }
  | {
      kind: 'editText'
      /** The text block being replaced. */
      rect: Rect
      original: string
      text: string
      style: EditTextStyle
      originalStyle: EditTextStyle
      /** The original font's name, for showing the text in something similar. */
      fontName: string
      /** Reading direction of the text, clockwise as displayed. */
      rotation: Rotation
    }
  | {
      kind: 'image'
      rect: Rect
      rotation: Rotation
      /** The file, base64 (PNG, JPEG or SVG). */
      data: string
      /** An object URL for showing it. */
      url: string
      /** Width / height of the picture before turning. */
      aspect: number
      label: 'Image' | 'Signature' | 'Initials'
      /** Also place it on these pages (initials on every page). */
      pages?: number[]
    }
  | { kind: 'shape'; shape: 'square' | 'circle'; rect: Rect; style: ShapeOptions }
  | { kind: 'line'; points: [Point, Point]; arrow: boolean; style: ShapeOptions }
  | { kind: 'ink'; strokes: Point[][]; style: PenOptions }

export interface Pending {
  tabId: string
  page: number
  object: PendingObject
}

interface PendingState {
  pending: Pending | null
  set: (pending: Pending | null) => void
  /** Changes the pending object (if it is still of the same kind). */
  update: (change: (object: PendingObject) => PendingObject) => void
}

export const usePending = create<PendingState>((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
  update: (change) =>
    set((state) =>
      state.pending ? { pending: { ...state.pending, object: change(state.pending.object) } } : {}
    )
}))

/** The box an object occupies on the page, in points. */
export function objectBounds(object: PendingObject): Rect {
  switch (object.kind) {
    case 'line':
      return pointsBounds(object.points)
    case 'ink': {
      const points = object.strokes.flat()
      return points.length > 0 ? pointsBounds(points) : [0, 0, 0, 0]
    }
    default:
      return object.rect
  }
}

function author(): string | undefined {
  return useSettings.getState().authorName || undefined
}

function release(object: PendingObject): void {
  if (object.kind === 'image') URL.revokeObjectURL(object.url)
}

/** Drops the pending object without changing the document. */
export function cancelPending(): void {
  const pending = usePending.getState().pending
  if (!pending) return
  usePending.getState().set(null)
  release(pending.object)
}

/** Replaces the pending object, committing the previous one first. */
export function startPending(pending: Pending): void {
  void commitPending()
  usePending.getState().set(pending)
}

function sameStyle(a: EditTextStyle, b: EditTextStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.color === b.color &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.align === b.align
  )
}

function textCall(
  object: Extract<PendingObject, { kind: 'text' }>,
  page: number
): ((docId: string) => Promise<MutationResult>) | null {
  const text = object.text.replace(/\s+$/, '')
  const { style } = object
  if (object.annotId !== undefined) {
    const annotId = object.annotId
    if (text.trim() === '') return (docId) => engine.deleteAnnotation(docId, annotId, page)
    return (docId) =>
      engine.updateAnnotation(docId, annotId, page, {
        text,
        rect: object.rect,
        rotation: object.rotation,
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        bold: style.bold,
        italic: style.italic,
        align: style.align
      })
  }
  if (text.trim() === '') return null
  return (docId) =>
    engine.createAnnotation(docId, {
      type: 'freetext',
      page,
      rect: object.rect,
      text,
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      bold: style.bold,
      italic: style.italic,
      align: style.align,
      rotation: object.rotation,
      author: author()
    })
}

function editTextCall(
  object: Extract<PendingObject, { kind: 'editText' }>,
  page: number
): ((docId: string) => Promise<TextReplaceResult>) | null {
  const text = object.text.replace(/\s+$/, '')
  if (text === object.original.replace(/\s+$/, '') && sameStyle(object.style, object.originalStyle))
    return null
  const { style, originalStyle } = object
  // Only what the user changed; the engine keeps the rest of the original.
  const changes = {
    ...(style.fontFamily !== originalStyle.fontFamily && style.fontFamily
      ? { fontFamily: style.fontFamily }
      : {}),
    ...(style.fontSize !== originalStyle.fontSize ? { fontSize: style.fontSize } : {}),
    ...(style.color !== originalStyle.color ? { color: style.color } : {}),
    ...(style.bold !== originalStyle.bold ? { bold: style.bold } : {}),
    ...(style.italic !== originalStyle.italic ? { italic: style.italic } : {}),
    ...(style.align !== originalStyle.align ? { align: style.align } : {})
  }
  return (docId) => engine.replaceText(docId, page, { bbox: object.rect, text, ...changes })
}

function callFor(pending: Pending): ((docId: string) => Promise<MutationResult>) | null {
  const { object, page } = pending
  switch (object.kind) {
    case 'text':
      return textCall(object, page)
    case 'editText':
      return editTextCall(object, page)
    case 'image':
      return (docId) =>
        engine.insertImage(docId, page, {
          rect: object.rect,
          rotation: object.rotation,
          data: object.data,
          label: object.label,
          ...(object.pages && object.pages.length > 0 ? { pages: object.pages } : {})
        })
    case 'shape':
      return (docId) =>
        engine.createAnnotation(docId, {
          type: object.shape,
          page,
          rect: object.rect,
          color: object.style.color,
          fill: object.style.fill,
          width: object.style.width,
          opacity: object.style.opacity,
          author: author()
        })
    case 'line': {
      const [a, b] = object.points
      if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return null
      return (docId) =>
        engine.createAnnotation(docId, {
          type: 'line',
          page,
          points: [
            [a.x, a.y],
            [b.x, b.y]
          ],
          arrowEnd: object.arrow,
          color: object.style.color,
          width: object.style.width,
          opacity: object.style.opacity,
          author: author()
        })
    }
    case 'ink': {
      const strokes = object.strokes.filter((stroke) => stroke.length > 0)
      if (strokes.length === 0) return null
      return (docId) =>
        engine.createAnnotation(docId, {
          type: 'ink',
          page,
          strokes: strokes.map((stroke) =>
            stroke.map((point): [number, number] => [point.x, point.y])
          ),
          color: object.style.color,
          width: object.style.width,
          opacity: object.style.opacity,
          author: author()
        })
    }
  }
}

const FAILURES: Record<PendingObject['kind'], string> = {
  text: 'Could not add the text',
  editText: 'Could not change the text',
  image: 'Could not add the image',
  shape: 'Could not add the shape',
  line: 'Could not add the line',
  ink: 'Could not add the drawing'
}

function reportTextResult(result: TextReplaceResult): void {
  const notes: string[] = []
  if (result.substituted && result.font) {
    notes.push(`The original font could not show the new text; ${result.font} was used instead.`)
  }
  if (result.fontScale !== undefined && result.fontScale < 0.995) {
    notes.push(`The text was made ${Math.round(result.fontScale * 100)} % of its size to fit.`)
  }
  if (notes.length > 0) {
    toast.info(result.substituted ? 'Font substituted' : 'Text resized', {
      description: notes.join(' ')
    })
  }
}

/**
 * Writes the pending object into its document. Resolves once the engine has
 * answered (or at once if there is nothing to write).
 */
export async function commitPending(): Promise<void> {
  const pending = usePending.getState().pending
  if (!pending) return
  usePending.getState().set(null)
  release(pending.object)
  const call = callFor(pending)
  if (!call) return
  if (pending.object.kind === 'text' && pending.object.annotId !== undefined) {
    selectAnnotation(pending.tabId, null)
  }
  const result = await mutate(pending.tabId, call, FAILURES[pending.object.kind])
  if (result && pending.object.kind === 'editText') reportTextResult(result as TextReplaceResult)
}

/** Commits whenever the tool or the tab changes. Returns a function that stops it. */
export function installPendingCommits(): () => void {
  const stopTools = useTools.subscribe((state, previous) => {
    if (state.activeTool !== previous.activeTool) void commitPending()
  })
  const stopTabs = useTabs.subscribe((state, previous) => {
    if (state.activeTabId !== previous.activeTabId) void commitPending()
    const pending = usePending.getState().pending
    if (pending && !state.tabs.some((tab) => tab.id === pending.tabId)) cancelPending()
  })
  return () => {
    stopTools()
    stopTabs()
  }
}

/** Opens an existing text box for typing, in the edit overlay. */
export function editTextBox(tabId: string, annotation: Annotation): void {
  startPending({
    tabId,
    page: annotation.page,
    object: {
      kind: 'text',
      annotId: annotation.annotId,
      rect: annotation.box ?? annotation.rect,
      text: annotation.text ?? annotation.contents,
      rotation: (annotation.rotation ?? 0) as Rotation,
      fill: annotation.fill ?? null,
      style: {
        fontFamily: annotation.fontFamily ?? DEFAULT_TEXT.fontFamily,
        fontSize: annotation.fontSize ?? DEFAULT_TEXT.fontSize,
        color: annotation.color ?? DEFAULT_TEXT.color,
        bold: annotation.bold ?? false,
        italic: annotation.italic ?? false,
        align: annotation.align ?? 'left'
      }
    }
  })
}
