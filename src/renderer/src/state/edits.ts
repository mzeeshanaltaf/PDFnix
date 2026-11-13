/**
 * Everything that changes a document: annotations, page rotation, undo and
 * redo. Every change goes through `mutate`, which applies the engine's answer
 * to the tab (dirty pages re-render, undo state updates) and reports failures.
 */

import { toast } from 'sonner'
import {
  engine,
  type Annotation,
  type AnnotationChange,
  type MarkupType,
  type MutationResult,
  type SearchHit
} from '../api/engine'
import { piecesToMarkup } from '../tools/quads'
import { getViewer } from '../viewer/controller'
import { rotateQuad } from '../viewer/geometry'
import { clearTextSelection, selectedWordPieces } from '../viewer/selection'
import { loadOutline, runSearch } from './documents'
import { useSettings } from './settings'
import { getTab, useTabs, type DocumentTab, type SelectedAnnotation } from './tabs'
import { useTools } from './tools'

/** Changes to a document are sent one after the other, so answers apply in order. */
const queues = new Map<string, Promise<unknown>>()

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function author(): string | undefined {
  return useSettings.getState().authorName || undefined
}

/** Pages whose rotation the result changes. */
function turnedPages(before: DocumentTab, result: MutationResult): number[] {
  return result.pages
    .filter((page) => before.pages[page.index]?.rotation !== page.rotation)
    .map((page) => page.index)
}

/**
 * Runs a change against the tab's engine session and applies the result.
 * Resolves to the result, or null if it failed (the user has been told) or
 * the tab has gone.
 */
export function mutate<T extends MutationResult>(
  tabId: string,
  call: (docId: string) => Promise<T>,
  failure: string,
  options: {
    onTurned?: (before: DocumentTab, turned: number[]) => void
    /** Errors not to report (the user cancelled, say). */
    ignore?: (error: unknown) => boolean
  } = {}
): Promise<T | null> {
  const previous = queues.get(tabId) ?? Promise.resolve()
  const next = previous.then(async (): Promise<T | null> => {
    const tab = getTab(tabId)
    if (!tab) return null
    try {
      const result = await call(tab.docId)
      const current = getTab(tabId)
      if (!current || current.docId !== tab.docId) return null
      if (result.structure) {
        // Pages moved, appeared or went: the outline and search hits point at
        // old positions.
        useTabs.getState().applyMutation(tabId, result)
        void loadOutline(tabId)
        if (current.search.query.trim() !== '') void runSearch(tabId)
        return result
      }
      const turned = turnedPages(current, result)
      if (turned.length > 0) getViewer(tabId)?.holdPage(current.page)
      useTabs.getState().applyMutation(tabId, result)
      if (turned.length > 0) {
        if (options.onTurned) options.onTurned(current, turned)
        // Search hits are positions on the page; a page that turned needs new ones.
        else if (current.search.query.trim() !== '') void runSearch(tabId)
      }
      return result
    } catch (error) {
      if (!options.ignore?.(error)) toast.error(failure, { description: describe(error) })
      return null
    }
  })
  const settled = next.catch(() => null)
  queues.set(tabId, settled)
  void settled.then(() => {
    if (queues.get(tabId) === settled) queues.delete(tabId)
  })
  return next
}

export function selectAnnotation(tabId: string, selection: SelectedAnnotation | null): void {
  useTabs.getState().selectAnnotation(tabId, selection)
  const editing = useTools.getState().editing
  if (
    editing &&
    editing.tabId === tabId &&
    (selection === null || selection.annotId !== editing.annotId)
  ) {
    useTools.getState().setEditing(null)
  }
}

/** Opens the comment pop-up of an annotation (and selects it). */
export function editComment(tabId: string, selection: SelectedAnnotation): void {
  useTabs.getState().selectAnnotation(tabId, selection)
  useTools.getState().setEditing({ tabId, ...selection })
}

/** True if text on a page is selected. */
export function hasTextSelection(): boolean {
  return selectedWordPieces(document.getSelection()).length > 0
}

/**
 * Turns the selected text into highlight, underline or strikeout annotations
 * (one per page the selection touches). Resolves to the annotations created;
 * empty if no text was selected.
 */
export async function markSelection(
  tabId: string,
  kind: MarkupType,
  options: { contents?: string; color?: string } = {}
): Promise<Annotation[]> {
  const groups = piecesToMarkup(selectedWordPieces(document.getSelection()))
  if (groups.length === 0) return []
  clearTextSelection()
  const color = options.color ?? useTools.getState().colors[kind]
  const created: Annotation[] = []
  for (const group of groups) {
    const result = await mutate(
      tabId,
      (docId) =>
        engine.createAnnotation(docId, {
          type: kind,
          page: group.page,
          quads: group.quads,
          color,
          author: author(),
          ...(options.contents ? { contents: options.contents } : {})
        }),
      `Could not add the ${kind}`
    )
    if (result) created.push(result.annotation)
  }
  return created
}

/** Highlights the selected text and opens the comment pop-up for it. */
export async function commentOnSelection(tabId: string, color?: string): Promise<void> {
  const created = await markSelection(tabId, 'highlight', { color })
  const last = created[created.length - 1]
  if (last) editComment(tabId, { annotId: last.annotId, page: last.page })
}

/** Drops a note at `point` (points, displayed space) and opens it for typing. */
export async function addNote(tabId: string, page: number, point: [number, number]): Promise<void> {
  const result = await mutate(
    tabId,
    (docId) =>
      engine.createAnnotation(docId, {
        type: 'note',
        page,
        point,
        color: useTools.getState().colors.note,
        author: author()
      }),
    'Could not add the note'
  )
  if (result) {
    editComment(tabId, { annotId: result.annotation.annotId, page })
  }
}

export async function changeAnnotation(
  tabId: string,
  target: SelectedAnnotation,
  change: AnnotationChange
): Promise<Annotation | null> {
  const result = await mutate(
    tabId,
    (docId) => engine.updateAnnotation(docId, target.annotId, target.page, change),
    'Could not change the annotation'
  )
  return result?.annotation ?? null
}

export async function deleteAnnotation(tabId: string, target: SelectedAnnotation): Promise<void> {
  const tab = getTab(tabId)
  if (tab?.selectedAnnotation?.annotId === target.annotId) selectAnnotation(tabId, null)
  await mutate(
    tabId,
    (docId) => engine.deleteAnnotation(docId, target.annotId, target.page),
    'Could not delete the annotation'
  )
}

/** Deletes the selected annotation, if any. Returns whether there was one. */
export function deleteSelected(tabId: string): boolean {
  const selected = getTab(tabId)?.selectedAnnotation
  if (!selected) return false
  void deleteAnnotation(tabId, selected)
  return true
}

/**
 * Rotates the current page, or all pages, by a quarter turn (positive is
 * clockwise). Search hits on the turned pages turn with them.
 */
export async function rotatePages(
  tabId: string,
  degrees: 90 | -90,
  scope: 'current' | 'all'
): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  const pages = scope === 'all' ? undefined : [tab.page]
  await mutate(tabId, (docId) => engine.rotatePages(docId, degrees, pages), 'Could not rotate', {
    onTurned: (before, turned) => {
      if (before.search.hits.length === 0) return
      const set = new Set(turned)
      const hits = before.search.hits.map((hit): SearchHit =>
        set.has(hit.page)
          ? {
              ...hit,
              quads: hit.quads.map((quad) => rotateQuad(quad, before.pages[hit.page], degrees))
            }
          : hit
      )
      useTabs.getState().patchSearch(tabId, { hits })
    }
  })
}

export async function undo(tabId: string): Promise<void> {
  if (!getTab(tabId)?.history.canUndo) return
  selectAnnotation(tabId, null)
  await mutate(tabId, (docId) => engine.undo(docId), 'Could not undo')
}

export async function redo(tabId: string): Promise<void> {
  if (!getTab(tabId)?.history.canRedo) return
  selectAnnotation(tabId, null)
  await mutate(tabId, (docId) => engine.redo(docId), 'Could not redo')
}
