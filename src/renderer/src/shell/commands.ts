/**
 * The app's commands. The toolbar, the application menu and the keyboard all
 * run the same ones through `runCommand`.
 */

import { toast } from 'sonner'
import type { MenuCommand } from '../../../shared/api'
import {
  askPageRange,
  confirmAction,
  showConvert,
  showImagesToPdf,
  showMerge,
  showAbout,
  showCodes,
  showOcrLanguages,
  showPreferences,
  showProperties,
  showShortcuts,
  showToolDialog
} from '@/state/dialogs'
import { wordToPdf } from '@/state/processing'
import { commitFormInput, flattenForm, resetForm, useForms } from '@/state/forms'
import { extractPages, insertBlank, insertFromFile } from '@/state/pageOps'
import { redactCommand } from '@/state/redaction'
import { closeTab, openWithDialog, saveTab, stepSearch } from '@/state/documents'
import {
  deleteSelected,
  hasTextSelection,
  markSelection,
  redo,
  rotatePages,
  selectAnnotation,
  undo
} from '@/state/edits'
import { getActiveTab, useTabs, type SidePanelId } from '@/state/tabs'
import { cancelPending, commitPending, usePending } from '@/state/pending'
import { armSignature, useSignatures } from '@/state/signatures'
import { useTools, type ToolId } from '@/state/tools'
import { addImageFromFile } from '@/tools/images'
import type { MarkupType } from '@/api/engine'
import { getViewer } from '@/viewer/controller'

export type CommandId =
  | MenuCommand
  | 'file.open'
  | 'tabs.next'
  | 'tabs.previous'
  /** Escape: close the comment pop-up, drop the selection, go back to Select. */
  | 'edit.escape'

/** The search panel listens for this to put the cursor in its query box. */
export const FOCUS_SEARCH_EVENT = 'pdfnix:focus-search'

export function setSidePanel(tabId: string, open: boolean, panel?: SidePanelId): void {
  const tab = useTabs.getState().tabs.find((candidate) => candidate.id === tabId)
  if (!tab) return
  useTabs.getState().patchTab(tabId, { sidePanel: { open, panel: panel ?? tab.sidePanel.panel } })
}

/** Opens the search panel and puts the cursor in the query box. */
export function openSearch(tabId: string): void {
  setSidePanel(tabId, true, 'search')
  // The panel may only just be mounting; tell it once it is there.
  requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)))
}

/** Arms a tool, or goes back to Select if it is already armed. */
export function toggleTool(tool: ToolId): void {
  const tools = useTools.getState()
  tools.setActiveTool(tools.activeTool === tool && tool !== 'select' ? 'select' : tool)
}

/**
 * Highlight, underline or strikeout: marks the selected text if there is
 * any, otherwise arms the tool for dragging across text.
 */
function markupCommand(tabId: string, kind: MarkupType): void {
  if (hasTextSelection()) void markSelection(tabId, kind)
  else toggleTool(kind)
}

/** Commits a pending object and sends form values typed but not yet sent. */
export async function commitAll(tabId: string): Promise<void> {
  await commitPending()
  await commitFormInput(tabId)
}

function formFieldsOf(tabId: string): number {
  const fields = useForms.getState().fields[tabId]?.fields ?? []
  return fields.filter((field) => !field.flags.readOnly && field.type !== 'signature').length
}

function toggleFieldHighlight(tabId: string): void {
  if (formFieldsOf(tabId) === 0) {
    toast.info('This document has no form fields')
    return
  }
  const forms = useForms.getState()
  forms.setHighlight(!forms.highlight)
}

/** Reset or flatten the form, after asking. */
export async function confirmFormAction(tabId: string, action: 'reset' | 'flatten'): Promise<void> {
  if (formFieldsOf(tabId) === 0) {
    toast.info('This document has no form fields')
    return
  }
  const yes = await confirmAction(
    action === 'reset'
      ? {
          title: 'Reset the form?',
          message: 'Every field goes back to its default value, usually empty. You can undo this.',
          confirmLabel: 'Reset form'
        }
      : {
          title: 'Flatten the form?',
          message:
            'The fields become part of the page: their values stay visible but can no longer be changed in any program. You can undo this until you close the document.',
          confirmLabel: 'Flatten form'
        }
  )
  if (!yes) return
  if (action === 'reset') await resetForm(tabId)
  else await flattenForm(tabId)
}

export function runCommand(command: CommandId): void {
  if (command === 'file.open') {
    void openWithDialog()
    return
  }
  if (command === 'file.preferences') {
    showPreferences(true)
    return
  }
  if (command === 'help.about') {
    showAbout(true)
    return
  }
  if (command === 'help.shortcuts') {
    showShortcuts(true)
    return
  }
  if (command === 'tabs.next' || command === 'tabs.previous') {
    useTabs.getState().cycleTab(command === 'tabs.next' ? 1 : -1)
    return
  }
  if (command === 'tools.select') {
    useTools.getState().setActiveTool('select')
    return
  }
  if (command === 'tools.manageSignatures') {
    useSignatures.getState().showDialog('signature')
    return
  }
  if (command === 'document.merge') {
    showMerge(true)
    return
  }
  if (command === 'tools.ocrLanguages') {
    showOcrLanguages(true)
    return
  }
  if (command === 'convert.imagesToPdf') {
    showImagesToPdf(true)
    return
  }
  if (command === 'convert.wordToPdf') {
    void wordToPdf()
    return
  }

  // Everything else acts on the open document.
  const tab = getActiveTab()
  if (!tab) return
  const viewer = getViewer(tab.id)
  const store = useTabs.getState()

  switch (command) {
    // Whatever is being placed or typed into a form becomes part of the
    // document first.
    case 'file.save':
      void commitAll(tab.id).then(() => saveTab(tab.id))
      break
    case 'file.saveAs':
      void commitAll(tab.id).then(() => saveTab(tab.id, true))
      break
    case 'file.closeTab':
      void commitAll(tab.id).then(() => closeTab(tab.id))
      break
    case 'tools.redact':
      redactCommand(tab.id)
      break
    case 'document.organise':
      showToolDialog('organiseTabId', tab.id)
      break
    case 'document.insertBlank':
      void insertBlank(tab.id, tab.page + 1)
      break
    case 'document.insertFromFile':
      void insertFromFile(tab.id, tab.page + 1)
      break
    case 'document.extract':
      void askPageRange({
        title: 'Extract Pages',
        description: 'The pages are written to a new PDF file; this document is not changed.',
        initial: String(tab.page + 1),
        pageCount: tab.pageCount,
        confirmLabel: 'Extract…'
      }).then((pages) => pages && extractPages(tab.id, pages))
      break
    case 'document.split':
      showToolDialog('splitTabId', tab.id)
      break
    // Jobs read the document as the engine has it, so whatever is being
    // placed or typed goes in first (the dialogs' actions do that).
    case 'file.print':
      showToolDialog('printTabId', tab.id)
      break
    case 'tools.compress':
      showToolDialog('compressTabId', tab.id)
      break
    case 'tools.protect':
      showToolDialog('protectTabId', tab.id)
      break
    case 'tools.ocr':
      showToolDialog('ocrTabId', tab.id)
      break
    case 'tools.codes':
      showCodes(tab.id)
      break
    case 'convert.toWord':
      showConvert(tab.id, 'word')
      break
    case 'convert.toImages':
      showConvert(tab.id, 'images')
      break
    case 'convert.toText':
      showConvert(tab.id, 'text')
      break
    case 'document.redact':
      showToolDialog('redactTabId', tab.id)
      break
    case 'document.watermark':
      showToolDialog('watermarkTabId', tab.id)
      break
    case 'document.headerFooter':
      showToolDialog('headerFooterTabId', tab.id)
      break
    case 'forms.highlight':
      toggleFieldHighlight(tab.id)
      break
    case 'forms.reset':
      void confirmFormAction(tab.id, 'reset')
      break
    case 'forms.flatten':
      void confirmFormAction(tab.id, 'flatten')
      break
    case 'file.properties':
      showProperties(tab.id)
      break
    case 'edit.undo':
      // Undo while placing something drops it instead.
      if (usePending.getState().pending) cancelPending()
      else void undo(tab.id)
      break
    case 'edit.redo':
      void redo(tab.id)
      break
    case 'edit.delete':
      deleteSelected(tab.id)
      break
    case 'edit.escape': {
      const tools = useTools.getState()
      if (usePending.getState().pending) void commitPending()
      else if (tools.editing) tools.setEditing(null)
      else if (tab.selectedAnnotation) selectAnnotation(tab.id, null)
      else if (tools.activeTool !== 'select') tools.setActiveTool('select')
      break
    }
    case 'tools.highlight':
    case 'tools.underline':
    case 'tools.strikeout':
      markupCommand(tab.id, command.slice('tools.'.length) as MarkupType)
      break
    case 'tools.note':
      toggleTool('note')
      break
    case 'tools.hand':
      toggleTool('hand')
      break
    case 'tools.text':
      toggleTool('text')
      break
    case 'tools.editText':
      toggleTool('editText')
      break
    case 'tools.shape':
      toggleTool('shape')
      break
    case 'tools.draw':
      toggleTool('draw')
      break
    case 'tools.deleteObject':
      toggleTool('deleteObject')
      break
    case 'tools.image':
      void addImageFromFile(tab.id)
      break
    case 'tools.sign':
      void armSignature('signature')
      break
    case 'tools.initials':
      void armSignature('initials')
      break
    case 'tools.initialsAllPages':
      void armSignature('initials', { allPages: true })
      break
    case 'edit.find':
      openSearch(tab.id)
      break
    case 'edit.findNext':
      if (tab.search.query.trim() === '') openSearch(tab.id)
      else stepSearch(tab.id, 1)
      break
    case 'edit.findPrevious':
      if (tab.search.query.trim() === '') openSearch(tab.id)
      else stepSearch(tab.id, -1)
      break
    case 'view.zoomIn':
      viewer?.zoomStep(1)
      break
    case 'view.zoomOut':
      viewer?.zoomStep(-1)
      break
    case 'view.actualSize':
      viewer?.zoomTo(1)
      break
    case 'view.fitWidth':
      viewer?.setZoomMode('fit-width')
      break
    case 'view.fitPage':
      viewer?.setZoomMode('fit-page')
      break
    case 'view.rotateCw':
      void rotatePages(tab.id, 90, 'current')
      break
    case 'view.rotateCcw':
      void rotatePages(tab.id, -90, 'current')
      break
    case 'view.rotateAllCw':
      void rotatePages(tab.id, 90, 'all')
      break
    case 'view.rotateAllCcw':
      void rotatePages(tab.id, -90, 'all')
      break
    case 'view.toggleSidePanel':
      setSidePanel(tab.id, !tab.sidePanel.open)
      break
    case 'view.assistant':
      if (tab.sidePanel.open && tab.sidePanel.panel === 'assistant') setSidePanel(tab.id, false)
      else setSidePanel(tab.id, true, 'assistant')
      break
    case 'view.layout.continuous':
      store.patchTab(tab.id, { layout: 'continuous' })
      break
    case 'view.layout.single':
      store.patchTab(tab.id, { layout: 'single' })
      break
    case 'view.layout.two-page':
      store.patchTab(tab.id, { layout: 'two-page' })
      break
    case 'go.nextPage':
      viewer?.goToPage(tab.page + (tab.layout === 'two-page' ? 2 - (tab.page % 2) : 1))
      break
    case 'go.previousPage':
      viewer?.goToPage(tab.page - (tab.layout === 'two-page' ? 2 : 1))
      break
    case 'go.firstPage':
      viewer?.goToPage(0)
      break
    case 'go.lastPage':
      viewer?.goToPage(tab.pageCount - 1)
      break
  }
}
