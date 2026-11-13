/**
 * Everything the app does with documents that involves the engine: opening
 * and closing them, rotating pages, searching. The tab store itself
 * (`tabs.ts`) only holds state; the calls and their error handling are here.
 */

import { toast } from 'sonner'
import { engine, EngineApiError, isAbortError, type SearchHit } from '../api/engine'
import { getViewer } from '../viewer/controller'
import { quadBounds, rotateQuad } from '../viewer/geometry'
import { pageImages } from '../viewer/pageImages'
import { pageTexts } from '../viewer/pageText'
import { forgetViewPosition } from '../viewer/viewPositions'
import { askPassword, closePasswordPrompt, useDialogs } from './dialogs'
import { useEngine } from './engine'
import { findTabByPath, getTab, selectActiveTab, useTabs, type SearchState } from './tabs'

const APP_NAME = 'PDFnix'
/** Typing in the search box searches after this pause. */
const SEARCH_DELAY_MS = 250

/**
 * Passwords of the protected documents that are open, by tab. They are needed
 * to open the file again if the engine is restarted, and are never stored.
 */
const passwords = new Map<string, string>()
/** Files being opened right now, so a double request opens them once. */
const opening = new Set<string>()
const searches = new Map<
  string,
  { timer?: ReturnType<typeof setTimeout>; abort?: AbortController }
>()

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPasswordError(error: unknown): error is EngineApiError {
  return (
    error instanceof EngineApiError &&
    (error.code === 'password_required' || error.code === 'password_incorrect')
  )
}

// --- opening and closing -----------------------------------------------------

/**
 * Opens a file in a new tab, asking for its password if it has one. A file
 * that is already open is brought to the front instead. Resolves to whether
 * the file is now showing.
 */
export async function openPath(path: string): Promise<boolean> {
  const store = useTabs.getState()
  const existing = findTabByPath(store.tabs, path)
  if (existing) {
    store.activateTab(existing.id)
    return true
  }

  const key = path.toLowerCase()
  if (opening.has(key)) return false
  opening.add(key)

  const name = fileNameOf(path)
  let password: string | undefined
  let asked = false
  try {
    for (;;) {
      try {
        const opened = await engine.openDocument(path, password)
        if (asked) closePasswordPrompt()

        // The engine reports the absolute path, which may be a file we have.
        const duplicate = findTabByPath(useTabs.getState().tabs, opened.path)
        if (duplicate) {
          void engine.closeDocument(opened.docId).catch(() => {})
          useTabs.getState().activateTab(duplicate.id)
          return true
        }

        const id = useTabs.getState().addTab(opened)
        if (opened.isEncrypted && password !== undefined) passwords.set(id, password)
        void window.api.files.addRecent(opened.path)
        void loadOutline(id)
        return true
      } catch (error) {
        if (isPasswordError(error)) {
          asked = true
          const entered = await askPassword(name, error.code === 'password_incorrect')
          if (entered === null) return false
          password = entered
          continue
        }
        if (asked) closePasswordPrompt()
        toast.error(`Could not open ${name}`, { description: describe(error) })
        if (error instanceof EngineApiError && error.code === 'file_not_found') {
          void window.api.files.removeRecent(path)
        }
        return false
      }
    }
  } finally {
    opening.delete(key)
  }
}

/** Opens several files one after the other; the last one ends up in front. */
export async function openPaths(paths: readonly string[]): Promise<void> {
  for (const path of paths) await openPath(path)
}

export async function openWithDialog(): Promise<void> {
  await openPaths(await window.api.files.showOpenDialog())
}

/** Opens the PDFs among files dropped onto the window. */
export async function openDroppedFiles(files: Iterable<File>): Promise<void> {
  const paths: string[] = []
  let skipped = 0
  for (const file of files) {
    const path = window.api.files.pathForFile(file)
    if (path && /\.pdf$/i.test(path)) paths.push(path)
    else skipped += 1
  }
  if (skipped > 0) {
    toast.warning(paths.length === 0 ? 'Only PDF files can be opened' : 'Some files are not PDFs', {
      description: paths.length === 0 ? undefined : 'They were skipped.'
    })
  }
  await openPaths(paths)
}

function forgetDocument(tabId: string, docId: string): void {
  const search = searches.get(tabId)
  if (search) {
    clearTimeout(search.timer)
    search.abort?.abort()
    searches.delete(tabId)
  }
  pageImages.dropDocument(docId)
  pageTexts.dropDocument(docId)
}

export async function closeTab(tabId: string): Promise<void> {
  const removed = useTabs.getState().removeTab(tabId)
  if (!removed) return
  passwords.delete(tabId)
  forgetViewPosition(tabId)
  forgetDocument(tabId, removed.docId)
  if (useDialogs.getState().propertiesTabId === tabId) {
    useDialogs.setState({ propertiesTabId: null })
  }
  try {
    await engine.closeDocument(removed.docId)
  } catch {
    // The engine is gone or has forgotten the document; nothing left to free.
  }
}

export async function loadOutline(tabId: string): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  try {
    const outline = await engine.outline(tab.docId)
    if (getTab(tabId)?.docId === tab.docId) useTabs.getState().patchTab(tabId, { outline })
  } catch {
    // No outline is not worth a message; the panel simply stays hidden.
    if (getTab(tabId)?.docId === tab.docId) useTabs.getState().patchTab(tabId, { outline: [] })
  }
}

// --- rotation -----------------------------------------------------------------

/**
 * Rotates the current page, or all pages, by a quarter turn (positive is
 * clockwise). The change lives in the engine's working copy; saving it to the
 * file arrives in phase 3.
 */
export async function rotatePages(
  tabId: string,
  degrees: 90 | -90,
  scope: 'current' | 'all'
): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  try {
    const result = await engine.rotatePages(
      tab.docId,
      degrees,
      scope === 'all' ? undefined : [tab.page]
    )
    const current = getTab(tabId)
    if (!current || current.docId !== tab.docId) return

    // Search hits on the turned pages turn with them.
    const turned = new Set(result.dirtyPages)
    const hits = current.search.hits.map((hit): SearchHit =>
      turned.has(hit.page)
        ? {
            ...hit,
            quads: hit.quads.map((quad) => rotateQuad(quad, current.pages[hit.page], degrees))
          }
        : hit
    )

    getViewer(tabId)?.holdPage(current.page)
    const store = useTabs.getState()
    store.applyMutation(tabId, result, result.pages)
    if (current.search.hits.length > 0) store.patchSearch(tabId, { hits })
  } catch (error) {
    toast.error('Could not rotate', { description: describe(error) })
  }
}

// --- search ---------------------------------------------------------------------

/** Selects a hit and scrolls it into view. */
export function activateHit(tabId: string, index: number): void {
  const tab = getTab(tabId)
  const hit = tab?.search.hits[index]
  if (!tab || !hit) return
  useTabs.getState().patchSearch(tabId, { activeIndex: index })

  // Everything the match covers, which may be more than one line.
  const boxes = hit.quads.map(quadBounds)
  getViewer(tabId)?.reveal(hit.page, [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3]))
  ])
}

/** Runs the search for the tab's current query now. */
export async function runSearch(tabId: string): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  const state = searches.get(tabId) ?? {}
  searches.set(tabId, state)
  clearTimeout(state.timer)
  state.timer = undefined
  state.abort?.abort()
  state.abort = undefined

  const store = useTabs.getState()
  const { query, matchCase, wholeWord } = tab.search
  if (query.trim() === '') {
    store.patchSearch(tabId, {
      status: 'idle',
      hits: [],
      truncated: false,
      activeIndex: -1,
      error: null
    })
    return
  }

  const abort = new AbortController()
  state.abort = abort
  store.patchSearch(tabId, { status: 'searching', error: null })
  try {
    const result = await engine.search(tab.docId, query, { matchCase, wholeWord }, abort.signal)
    if (abort.signal.aborted || !getTab(tabId)) return
    const page = getTab(tabId)?.page ?? 0
    // Start with the first hit on or after the page being read.
    const first = result.hits.findIndex((hit) => hit.page >= page)
    const activeIndex = result.hits.length === 0 ? -1 : Math.max(first, 0)
    useTabs.getState().patchSearch(tabId, {
      status: 'done',
      hits: result.hits,
      truncated: result.truncated,
      activeIndex,
      error: null
    })
    if (activeIndex >= 0) activateHit(tabId, activeIndex)
  } catch (error) {
    if (isAbortError(error) || abort.signal.aborted) return
    useTabs.getState().patchSearch(tabId, {
      status: 'error',
      hits: [],
      truncated: false,
      activeIndex: -1,
      error: describe(error)
    })
  } finally {
    if (state.abort === abort) state.abort = undefined
  }
}

/** Changes the query or its options and searches after a short pause. */
export function updateSearch(
  tabId: string,
  patch: Partial<Pick<SearchState, 'query' | 'matchCase' | 'wholeWord'>>
): void {
  if (!getTab(tabId)) return
  useTabs.getState().patchSearch(tabId, patch)
  const state = searches.get(tabId) ?? {}
  searches.set(tabId, state)
  clearTimeout(state.timer)
  state.timer = setTimeout(() => void runSearch(tabId), SEARCH_DELAY_MS)
}

/** Moves to the next (`1`) or previous (`-1`) hit, wrapping around. */
export function stepSearch(tabId: string, direction: 1 | -1): void {
  const tab = getTab(tabId)
  if (!tab) return
  const pendingSearch = searches.get(tabId)?.timer !== undefined
  if (pendingSearch || (tab.search.status === 'idle' && tab.search.query.trim() !== '')) {
    // The query was just typed: search now; the first hit is selected.
    void runSearch(tabId)
    return
  }
  const count = tab.search.hits.length
  if (count === 0) return
  const from = tab.search.activeIndex
  const next = from < 0 ? (direction > 0 ? 0 : count - 1) : (from + direction + count) % count
  activateHit(tabId, next)
}

// --- keeping in step with the engine and the main process ---------------------

/** Opens every document again after the engine was replaced by a new process. */
async function reopenAll(): Promise<void> {
  const tabs = useTabs.getState().tabs
  if (tabs.length === 0) return
  let changesLost = false
  const failed: string[] = []

  for (const tab of tabs) {
    forgetDocument(tab.id, tab.docId)
    try {
      const opened = await engine.openDocument(tab.filePath, passwords.get(tab.id))
      if (!getTab(tab.id)) {
        void engine.closeDocument(opened.docId).catch(() => {})
        continue
      }
      if (tab.revision > 0) changesLost = true
      useTabs.getState().rebindTab(tab.id, opened)
      void loadOutline(tab.id)
      if (tab.search.query.trim() !== '') void runSearch(tab.id)
    } catch {
      failed.push(tab.fileName)
      passwords.delete(tab.id)
      forgetViewPosition(tab.id)
      useTabs.getState().removeTab(tab.id)
    }
  }

  if (failed.length > 0) {
    toast.error('Some documents could not be reopened', { description: failed.join(', ') })
  }
  if (changesLost) {
    toast.warning('Unsaved changes were lost', {
      description: 'The PDF engine was restarted and the documents were opened again from disk.'
    })
  }
}

function reportToMain(): void {
  const active = selectActiveTab(useTabs.getState())
  window.api.menu.setState({ hasDocument: active !== null, layout: active?.layout ?? null })
  document.title = active ? `${active.fileName} - ${APP_NAME}` : APP_NAME
}

/**
 * Connects the documents to the outside world: opens the files main asks
 * for, reopens documents after an engine restart, and keeps the menu and the
 * window title in step with the active tab. Returns a function that undoes it.
 */
export function startDocumentSync(): () => void {
  let stopped = false
  let generation: number | null = null

  const unsubscribeEngine = useEngine.subscribe((state) => {
    if (state.link !== 'connected') return
    if (generation !== null && generation !== state.generation) void reopenAll()
    generation = state.generation
  })
  const unsubscribeTabs = useTabs.subscribe(reportToMain)
  reportToMain()

  const unsubscribeOpen = window.api.files.onOpenRequest((paths) => void openPaths(paths))
  void (async () => {
    // A page that starts afresh has no tabs, so whatever the engine still has
    // open belongs to a previous load of the page.
    await engine.closeAllDocuments().catch(() => {})
    if (stopped) return
    await openPaths(await window.api.files.takePending())
  })()

  return () => {
    stopped = true
    unsubscribeEngine()
    unsubscribeTabs()
    unsubscribeOpen()
  }
}
