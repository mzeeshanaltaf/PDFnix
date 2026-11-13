/**
 * Redaction: marking areas or selected text, reviewing the marks, and
 * applying them. Marks are only marks until applied; applying removes the
 * content for good once the document is saved.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { engine, isAbortError, type Rect, type RedactionMark } from '../api/engine'
import { piecesToMarkup } from '../tools/quads'
import { clearTextSelection, selectedWordPieces } from '../viewer/selection'
import { confirmAction, showToolDialog, useDialogs } from './dialogs'
import { mutate } from './edits'
import { commitPending } from './pending'
import { useTabs } from './tabs'
import { useTools } from './tools'

interface RedactOptions {
  /** Painted over the area once applied; null for none. */
  fill: string | null
  /** Written in the filled area, e.g. "REDACTED". */
  overlayText: string
  setFill: (fill: string | null) => void
  setOverlayText: (text: string) => void
}

export const useRedactOptions = create<RedactOptions>((set) => ({
  fill: '#000000',
  overlayText: '',
  setFill: (fill) => set({ fill }),
  setOverlayText: (overlayText) => set({ overlayText })
}))

function markOptions(): { fill: string | null; overlayText: string } {
  const { fill, overlayText } = useRedactOptions.getState()
  return { fill, overlayText: overlayText.trim() }
}

/** Tells the user where marks can be reviewed, unless they are looking at them. */
function announce(tabId: string, count: number): void {
  if (useDialogs.getState().redactTabId === tabId) return
  toast.info(count === 1 ? 'Marked for redaction' : `${count} areas marked for redaction`, {
    description: 'Nothing is removed until you apply the marks.',
    action: { label: 'Review', onClick: () => showToolDialog('redactTabId', tabId) }
  })
}

export async function markArea(tabId: string, page: number, rect: Rect): Promise<void> {
  const result = await mutate(
    tabId,
    (docId) => engine.markForRedaction(docId, page, { rects: [rect] }, markOptions()),
    'Could not mark the area'
  )
  if (result) announce(tabId, result.marks.length)
}

/** Marks the selected text (one mark per line, per page). False if none is selected. */
export async function markTextSelection(tabId: string): Promise<boolean> {
  const groups = piecesToMarkup(selectedWordPieces(document.getSelection()))
  if (groups.length === 0) return false
  clearTextSelection()
  let count = 0
  for (const group of groups) {
    const result = await mutate(
      tabId,
      (docId) => engine.markForRedaction(docId, group.page, { quads: group.quads }, markOptions()),
      'Could not mark the text'
    )
    if (result) count += result.marks.length
  }
  if (count > 0) announce(tabId, count)
  return true
}

/** R: marks the selected text, or arms the Redact tool for dragging areas. */
export function redactCommand(tabId: string): void {
  void markTextSelection(tabId).then((marked) => {
    if (marked) return
    const tools = useTools.getState()
    tools.setActiveTool(tools.activeTool === 'redact' ? 'select' : 'redact')
  })
}

export async function removeMark(tabId: string, annotId: number): Promise<void> {
  await mutate(
    tabId,
    (docId) => engine.removeRedactionMark(docId, annotId),
    'Could not remove the mark'
  )
}

export async function removeAllMarks(
  tabId: string,
  marks: readonly RedactionMark[]
): Promise<void> {
  for (const mark of marks) await removeMark(tabId, mark.annotId)
}

export async function searchAndMark(
  tabId: string,
  query: string,
  options: { matchCase: boolean; wholeWord: boolean; pages?: number[] }
): Promise<number | null> {
  await commitPending()
  const result = await mutate(
    tabId,
    (docId) => engine.searchAndMark(docId, query, { ...options, ...markOptions() }),
    'Could not search the document'
  )
  return result ? (result.matches ?? result.marks.length) : null
}

/** Asks for confirmation, then removes everything under the marks. */
export async function applyMarks(
  tabId: string,
  count: number,
  cleanMetadata: boolean
): Promise<boolean> {
  const yes = await confirmAction({
    title: 'Apply redactions?',
    message:
      `The content under ${count === 1 ? 'the mark' : `all ${count} marks`} will be removed: ` +
      'text, the covered parts of pictures, drawings, and comments or form fields in those areas.' +
      (cleanMetadata
        ? '\nThe document’s title, author and other properties are removed too.'
        : '') +
      '\n\nYou can still undo this until you save. Once saved, the removed content cannot be recovered.',
    confirmLabel: 'Apply redactions',
    destructive: true
  })
  if (!yes) return false
  await commitPending()
  const result = await mutate(
    tabId,
    (docId) => engine.applyRedactions(docId, cleanMetadata),
    'Could not apply the redactions'
  )
  if (result) {
    toast.success('Redactions applied', {
      description: 'Save the document to make them permanent.'
    })
    if (cleanMetadata) {
      // The title may have been removed.
      useTabs.getState().patchTab(tabId, { title: '' })
    }
  }
  return result !== null
}

/** The pending marks of a tab's document, refreshed after every change. */
export function useRedactionMarks(tabId: string | null): RedactionMark[] | null {
  const docId = useTabs((state) => state.tabs.find((tab) => tab.id === tabId)?.docId)
  const revision = useTabs((state) => state.tabs.find((tab) => tab.id === tabId)?.revision)
  const [marks, setMarks] = useState<{ docId: string; marks: RedactionMark[] } | null>(null)

  useEffect(() => {
    if (!tabId || !docId) return
    const controller = new AbortController()
    engine
      .redactionMarks(docId, controller.signal)
      .then((result) => setMarks({ docId, marks: result }))
      .catch((error: unknown) => {
        if (!isAbortError(error)) setMarks({ docId, marks: [] })
      })
    return () => controller.abort()
  }, [tabId, docId, revision])

  // The previous revision's marks are shown until the new ones arrive.
  if (!tabId || !docId || !marks || marks.docId !== docId) return null
  return marks.marks
}
