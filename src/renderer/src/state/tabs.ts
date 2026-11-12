import { create } from 'zustand'

/** One open document. Each tab corresponds to one engine session. */
export interface DocumentTab {
  /** The engine session id. */
  id: string
  title: string
  filePath: string | null
  pageCount: number
  /** Current page, 1-based. */
  page: number
  /** 1 = 100%. */
  zoom: number
  /** The engine's revision counter for this document; increases with every change. */
  revision: number
}

interface TabsState {
  tabs: DocumentTab[]
  activeTabId: string | null
}

// Phase 1 only establishes the shape. Opening, closing and switching tabs are
// added in phase 2 together with the engine's session endpoints.
export const useTabs = create<TabsState>(() => ({
  tabs: [],
  activeTabId: null
}))

export function selectActiveTab(state: TabsState): DocumentTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
}
