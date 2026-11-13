import { beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDocument } from '../api/engine'
import { findTabByPath, getActiveTab, selectActiveTab, useTabs } from './tabs'

function opened(name: string, pageCount = 3, docId = `doc-${name}`): OpenedDocument {
  return {
    docId,
    path: `C:\\Docs\\${name}`,
    fileName: name,
    pageCount,
    pages: Array.from({ length: pageCount }, () => ({ width: 612, height: 792, rotation: 0 })),
    title: '',
    isEncrypted: false,
    hasTextLayer: true,
    revision: 0,
    canUndo: false,
    canRedo: false,
    undoName: null,
    redoName: null,
    modified: false
  }
}

const CHANGED = {
  canUndo: true,
  canRedo: false,
  undoName: 'Rotate',
  redoName: null,
  modified: true
}

const store = (): ReturnType<typeof useTabs.getState> => useTabs.getState()

describe('tab store', () => {
  beforeEach(() => {
    useTabs.setState({ tabs: [], activeTabId: null })
  })

  it('adds a tab and makes it active', () => {
    const id = store().addTab(opened('a.pdf'))
    expect(store().activeTabId).toBe(id)
    const tab = getActiveTab()!
    expect(tab).toMatchObject({ fileName: 'a.pdf', page: 0, zoom: 1, layout: 'continuous' })
    expect(tab.pageRevisions).toEqual([0, 0, 0])
  })

  it('gives every tab its own id, even for the same document', () => {
    const a = store().addTab(opened('a.pdf'))
    const b = store().addTab(opened('a.pdf'))
    expect(a).not.toBe(b)
  })

  it('keeps page, zoom and layout per tab', () => {
    const a = store().addTab(opened('a.pdf', 10))
    const b = store().addTab(opened('b.pdf', 10))
    store().setPage(a, 7)
    store().setZoom(a, 2.5)
    store().patchTab(b, { layout: 'two-page' })
    store().setZoom(b, 0.5, 'fit-width')

    store().activateTab(a)
    expect(getActiveTab()).toMatchObject({
      page: 7,
      zoom: 2.5,
      zoomMode: 'custom',
      layout: 'continuous'
    })
    store().activateTab(b)
    expect(getActiveTab()).toMatchObject({
      page: 0,
      zoom: 0.5,
      zoomMode: 'fit-width',
      layout: 'two-page'
    })
  })

  it('clamps the page and the zoom', () => {
    const id = store().addTab(opened('a.pdf', 5))
    store().setPage(id, 99)
    expect(getActiveTab()!.page).toBe(4)
    store().setPage(id, -3)
    expect(getActiveTab()!.page).toBe(0)
    store().setZoom(id, 50)
    expect(getActiveTab()!.zoom).toBe(8)
    store().setZoom(id, 0)
    expect(getActiveTab()!.zoom).toBe(0.1)
  })

  it('does not re-render subscribers for a change that changes nothing', () => {
    const id = store().addTab(opened('a.pdf'))
    const before = store().tabs
    store().setPage(id, 0)
    store().setZoom(id, 1)
    expect(store().tabs).toBe(before)
  })

  it('cycles through tabs in both directions, wrapping around', () => {
    const a = store().addTab(opened('a.pdf'))
    const b = store().addTab(opened('b.pdf'))
    const c = store().addTab(opened('c.pdf'))
    store().cycleTab(1)
    expect(store().activeTabId).toBe(a)
    store().cycleTab(1)
    expect(store().activeTabId).toBe(b)
    store().cycleTab(-1)
    store().cycleTab(-1)
    expect(store().activeTabId).toBe(c)
  })

  describe('closing', () => {
    it('activates the tab that takes the place of the closed one', () => {
      const a = store().addTab(opened('a.pdf'))
      const b = store().addTab(opened('b.pdf'))
      const c = store().addTab(opened('c.pdf'))
      store().activateTab(b)
      store().removeTab(b)
      expect(store().activeTabId).toBe(c)
      store().removeTab(c)
      expect(store().activeTabId).toBe(a)
      store().removeTab(a)
      expect(store().activeTabId).toBeNull()
      expect(selectActiveTab(store())).toBeNull()
    })

    it('keeps the active tab when another one closes', () => {
      const a = store().addTab(opened('a.pdf'))
      const b = store().addTab(opened('b.pdf'))
      store().activateTab(a)
      expect(store().removeTab(b)?.fileName).toBe('b.pdf')
      expect(store().activeTabId).toBe(a)
    })

    it('ignores an unknown tab', () => {
      store().addTab(opened('a.pdf'))
      expect(store().removeTab('nope')).toBeNull()
      expect(store().tabs).toHaveLength(1)
    })
  })

  it('records a change: new revision, new page sizes, dirty pages re-render', () => {
    const id = store().addTab(opened('a.pdf', 3))
    store().applyMutation(id, {
      revision: 1,
      dirtyPages: [1],
      pageCount: 3,
      pages: [{ index: 1, width: 792, height: 612, rotation: 90 }],
      ...CHANGED
    })
    const tab = getActiveTab()!
    expect(tab.revision).toBe(1)
    expect(tab.pages[1]).toEqual({ width: 792, height: 612, rotation: 90 })
    expect(tab.pages[0]).toEqual({ width: 612, height: 792, rotation: 0 })
    expect(tab.pageRevisions).toEqual([0, 1, 0])
    expect(tab.history).toEqual(CHANGED)
  })

  it('tracks unsaved changes from the engine, not from the revision', () => {
    const id = store().addTab(opened('a.pdf', 3))
    expect(getActiveTab()!.history.modified).toBe(false)
    store().applyMutation(id, { revision: 1, dirtyPages: [0], pageCount: 3, pages: [], ...CHANGED })
    expect(getActiveTab()!.history.modified).toBe(true)
    // Undoing back to the saved state: the revision goes up, the document is clean.
    store().applyMutation(id, {
      revision: 2,
      dirtyPages: [0],
      pageCount: 3,
      pages: [],
      canUndo: false,
      canRedo: true,
      undoName: null,
      redoName: 'Rotate',
      modified: false
    })
    expect(getActiveTab()).toMatchObject({ revision: 2, history: { modified: false } })
  })

  it('moves a tab to its new file after Save As', () => {
    const id = store().addTab(opened('a.pdf'))
    store().applyMutation(id, { revision: 1, dirtyPages: [0], pageCount: 3, pages: [], ...CHANGED })
    store().applySaved(id, {
      path: 'D:\\Out\\b.pdf',
      fileName: 'b.pdf',
      revision: 1,
      ...CHANGED,
      modified: false
    })
    expect(getActiveTab()).toMatchObject({
      filePath: 'D:\\Out\\b.pdf',
      fileName: 'b.pdf',
      history: { modified: false, canUndo: true }
    })
    expect(findTabByPath(store().tabs, 'd:/out/B.pdf')?.id).toBe(id)
    expect(findTabByPath(store().tabs, 'C:\\Docs\\a.pdf')).toBeNull()
  })

  it('selects and deselects an annotation without needless updates', () => {
    const id = store().addTab(opened('a.pdf'))
    store().selectAnnotation(id, { annotId: 12, page: 1 })
    const before = store().tabs
    store().selectAnnotation(id, { annotId: 12, page: 1 })
    expect(store().tabs).toBe(before)
    store().selectAnnotation(id, null)
    expect(getActiveTab()!.selectedAnnotation).toBeNull()
  })

  it('moves a tab to a new engine session, keeping where the reader was', () => {
    const id = store().addTab(opened('a.pdf', 10))
    store().setPage(id, 6)
    store().setZoom(id, 2)
    store().patchSearch(id, { query: 'fox', status: 'done', activeIndex: 2 })
    store().rebindTab(id, opened('a.pdf', 10, 'new-session'))
    expect(getActiveTab()).toMatchObject({ docId: 'new-session', page: 6, zoom: 2 })
    expect(getActiveTab()!.search).toMatchObject({ query: 'fox', status: 'idle', hits: [] })
  })

  it('finds a tab by path regardless of case and slashes', () => {
    store().addTab(opened('Report.pdf'))
    expect(findTabByPath(store().tabs, 'c:/docs/report.PDF')?.fileName).toBe('Report.pdf')
    expect(findTabByPath(store().tabs, 'C:\\Docs\\other.pdf')).toBeNull()
  })
})
