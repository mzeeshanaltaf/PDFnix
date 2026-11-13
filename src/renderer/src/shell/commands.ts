/**
 * The app's commands. The toolbar, the application menu and the keyboard all
 * run the same ones through `runCommand`.
 */

import type { MenuCommand } from '../../../shared/api'
import { showProperties } from '@/state/dialogs'
import { closeTab, openWithDialog, rotatePages, stepSearch } from '@/state/documents'
import { getActiveTab, useTabs, type SidePanelId } from '@/state/tabs'
import { getViewer } from '@/viewer/controller'

export type CommandId = MenuCommand | 'file.open' | 'tabs.next' | 'tabs.previous'

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

export function runCommand(command: CommandId): void {
  if (command === 'file.open') {
    void openWithDialog()
    return
  }
  if (command === 'tabs.next' || command === 'tabs.previous') {
    useTabs.getState().cycleTab(command === 'tabs.next' ? 1 : -1)
    return
  }

  // Everything else acts on the open document.
  const tab = getActiveTab()
  if (!tab) return
  const viewer = getViewer(tab.id)
  const store = useTabs.getState()

  switch (command) {
    case 'file.closeTab':
      void closeTab(tab.id)
      break
    case 'file.properties':
      showProperties(tab.id)
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
