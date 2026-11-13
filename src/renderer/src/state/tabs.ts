import { create } from 'zustand'
import type { LayoutMode } from '../../../shared/api'
import type {
  MutationResult,
  OpenedDocument,
  OutlineEntry,
  PageInfo,
  SearchHit
} from '../api/engine'
import { clampZoom, type ZoomMode } from '../viewer/zoom'

export type SidePanelId = 'thumbnails' | 'outline' | 'search' | 'annotations'

export interface SearchState {
  query: string
  matchCase: boolean
  wholeWord: boolean
  /** `idle`: nothing searched yet. `done`: `hits` answer the current query. */
  status: 'idle' | 'searching' | 'done' | 'error'
  hits: SearchHit[]
  /** True when the engine stopped at its hit limit. */
  truncated: boolean
  /** Index into `hits` of the selected hit, or -1. */
  activeIndex: number
  error: string | null
}

/** One open document. Each tab corresponds to one engine session. */
export interface DocumentTab {
  /** Identifies the tab for as long as it is open. */
  id: string
  /** The engine session. Changes if the engine is restarted and the file reopened. */
  docId: string
  filePath: string
  fileName: string
  /** The document's own title; may be empty. */
  title: string
  isEncrypted: boolean
  hasTextLayer: boolean
  pageCount: number
  pages: PageInfo[]
  /** The engine's revision counter for this document; increases with every change. */
  revision: number
  /** Per page, the revision that last changed it. Page images are cached by this. */
  pageRevisions: number[]

  /** Current page, 0-based. */
  page: number
  /** 1 = 100 %. In a fit mode this is the zoom the fit currently works out to. */
  zoom: number
  zoomMode: ZoomMode
  layout: LayoutMode
  sidePanel: { open: boolean; panel: SidePanelId }
  search: SearchState
  /** `null` until it has been loaded. */
  outline: OutlineEntry[] | null
}

const EMPTY_SEARCH: SearchState = {
  query: '',
  matchCase: false,
  wholeWord: false,
  status: 'idle',
  hits: [],
  truncated: false,
  activeIndex: -1,
  error: null
}

interface TabsState {
  tabs: DocumentTab[]
  activeTabId: string | null

  /** Adds a tab for a freshly opened document, makes it active, returns its id. */
  addTab: (opened: OpenedDocument) => string
  /** Removes a tab and activates a neighbour. Returns the removed tab. */
  removeTab: (id: string) => DocumentTab | null
  activateTab: (id: string) => void
  /** Activates the next (`1`) or previous (`-1`) tab, wrapping around. */
  cycleTab: (direction: 1 | -1) => void
  patchTab: (id: string, patch: Partial<DocumentTab>) => void
  setPage: (id: string, page: number) => void
  setZoom: (id: string, zoom: number, mode?: ZoomMode) => void
  /** Records the result of a call that changed the document. */
  applyMutation: (
    id: string,
    result: MutationResult,
    pages?: readonly (PageInfo & { index: number })[]
  ) => void
  /** Points the tab at a new engine session of the same file (engine restart). */
  rebindTab: (id: string, opened: OpenedDocument) => void
  patchSearch: (id: string, patch: Partial<SearchState>) => void
}

let nextTabNumber = 1

function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 0
  return Math.min(Math.max(Math.trunc(page), 0), Math.max(pageCount - 1, 0))
}

export const useTabs = create<TabsState>((set, get) => {
  const update = (id: string, change: (tab: DocumentTab) => DocumentTab): void => {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return state
      const changed = change(state.tabs[index])
      if (changed === state.tabs[index]) return state
      const tabs = state.tabs.slice()
      tabs[index] = changed
      return { tabs }
    })
  }

  return {
    tabs: [],
    activeTabId: null,

    addTab: (opened) => {
      const id = `tab-${nextTabNumber++}`
      const tab: DocumentTab = {
        id,
        docId: opened.docId,
        filePath: opened.path,
        fileName: opened.fileName,
        title: opened.title,
        isEncrypted: opened.isEncrypted,
        hasTextLayer: opened.hasTextLayer,
        pageCount: opened.pageCount,
        pages: opened.pages,
        revision: opened.revision,
        pageRevisions: opened.pages.map(() => opened.revision),
        page: 0,
        zoom: 1,
        zoomMode: 'custom',
        layout: 'continuous',
        sidePanel: { open: false, panel: 'thumbnails' },
        search: EMPTY_SEARCH,
        outline: null
      }
      set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
      return id
    },

    removeTab: (id) => {
      const { tabs, activeTabId } = get()
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return null
      const remaining = tabs.filter((tab) => tab.id !== id)
      let nextActive = activeTabId
      if (activeTabId === id) {
        // The tab that slides into the gap, or the new last tab.
        nextActive = (remaining[index] ?? remaining[index - 1])?.id ?? null
      }
      set({ tabs: remaining, activeTabId: nextActive })
      return tabs[index]
    },

    activateTab: (id) => {
      if (get().tabs.some((tab) => tab.id === id)) set({ activeTabId: id })
    },

    cycleTab: (direction) => {
      const { tabs, activeTabId } = get()
      if (tabs.length < 2) return
      const index = tabs.findIndex((tab) => tab.id === activeTabId)
      const next = (index + direction + tabs.length) % tabs.length
      set({ activeTabId: tabs[next].id })
    },

    patchTab: (id, patch) => update(id, (tab) => ({ ...tab, ...patch })),

    setPage: (id, page) =>
      update(id, (tab) => {
        const clamped = clampPage(page, tab.pageCount)
        return clamped === tab.page ? tab : { ...tab, page: clamped }
      }),

    setZoom: (id, zoom, mode) =>
      update(id, (tab) => {
        const clamped = clampZoom(zoom)
        const zoomMode = mode ?? tab.zoomMode
        if (clamped === tab.zoom && zoomMode === tab.zoomMode) return tab
        return { ...tab, zoom: clamped, zoomMode }
      }),

    applyMutation: (id, result, changedPages) =>
      update(id, (tab) => {
        const pages = tab.pages.slice()
        const pageRevisions = tab.pageRevisions.slice()
        for (const changed of changedPages ?? []) {
          if (changed.index >= 0 && changed.index < pages.length) {
            pages[changed.index] = {
              width: changed.width,
              height: changed.height,
              rotation: changed.rotation
            }
          }
        }
        for (const index of result.dirtyPages) {
          if (index >= 0 && index < pageRevisions.length) pageRevisions[index] = result.revision
        }
        return {
          ...tab,
          revision: result.revision,
          pageCount: result.pageCount,
          pages,
          pageRevisions
        }
      }),

    rebindTab: (id, opened) =>
      update(id, (tab) => ({
        ...tab,
        docId: opened.docId,
        filePath: opened.path,
        fileName: opened.fileName,
        title: opened.title,
        isEncrypted: opened.isEncrypted,
        hasTextLayer: opened.hasTextLayer,
        pageCount: opened.pageCount,
        pages: opened.pages,
        revision: opened.revision,
        pageRevisions: opened.pages.map(() => opened.revision),
        page: clampPage(tab.page, opened.pageCount),
        // Hits were found in the old session; positions may no longer hold.
        search: { ...tab.search, status: 'idle', hits: [], truncated: false, activeIndex: -1 },
        outline: null
      })),

    patchSearch: (id, patch) =>
      update(id, (tab) => ({ ...tab, search: { ...tab.search, ...patch } }))
  }
})

export function selectActiveTab(
  state: Pick<TabsState, 'tabs' | 'activeTabId'>
): DocumentTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
}

/** The tab showing the file at `path`, if any. Windows paths ignore case. */
export function findTabByPath(tabs: readonly DocumentTab[], path: string): DocumentTab | null {
  const wanted = normalisePath(path)
  return tabs.find((tab) => normalisePath(tab.filePath) === wanted) ?? null
}

function normalisePath(path: string): string {
  return path.replace(/\//g, '\\').toLowerCase()
}

export function getTab(id: string): DocumentTab | null {
  return useTabs.getState().tabs.find((tab) => tab.id === id) ?? null
}

export function getActiveTab(): DocumentTab | null {
  return selectActiveTab(useTabs.getState())
}
