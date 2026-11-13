/**
 * Everything the app does with whole documents that involves the engine:
 * opening, saving and closing them, recovery copies, searching. The tab store
 * itself (`tabs.ts`) only holds state; the calls and their error handling are
 * here. Changes to a document's content are in `edits.ts`.
 */

import { toast } from 'sonner'
import {
  engine,
  EngineApiError,
  isAbortError,
  type OpenedDocument,
  type RecoveryEntry
} from '../api/engine'
import { getViewer } from '../viewer/controller'
import { quadBounds } from '../viewer/geometry'
import { pageImages } from '../viewer/pageImages'
import { pageAnnotations, pageBlocks, pageTexts } from '../viewer/pageText'
import { forgetViewPosition } from '../viewer/viewPositions'
import { askPassword, closePasswordPrompt, useDialogs } from './dialogs'
import { useEngine } from './engine'
import { findTabByPath, getTab, selectActiveTab, useTabs, type SearchState } from './tabs'
import { useTools } from './tools'

const APP_NAME = 'PDFnix'
/** Typing in the search box searches after this pause. */
const SEARCH_DELAY_MS = 250
/** Save errors that Save As can get around. */
const SAVE_AS_HELPS = new Set(['file_locked', 'file_read_only', 'folder_not_writable'])

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

function engineConnected(): boolean {
  return useEngine.getState().link === 'connected'
}

/**
 * Runs `attempt`, asking for a password while the engine says one is needed
 * or wrong. Resolves to the result and the password that worked, or null if
 * the user cancelled. Other errors are thrown.
 */
async function withPassword<T>(
  name: string,
  attempt: (password?: string) => Promise<T>,
  initial?: string
): Promise<{ result: T; password?: string } | null> {
  let password = initial
  let asked = false
  try {
    for (;;) {
      try {
        const result = await attempt(password)
        return { result, password }
      } catch (error) {
        if (!isPasswordError(error)) throw error
        asked = true
        const entered = await askPassword(name, error.code === 'password_incorrect')
        if (entered === null) return null
        password = entered
      }
    }
  } finally {
    if (asked) closePasswordPrompt()
  }
}

// --- opening ---------------------------------------------------------------

/** Adds a tab for a document the engine has just opened. */
function showOpened(opened: OpenedDocument, password?: string): string {
  const id = useTabs.getState().addTab(opened)
  if (opened.isEncrypted && password !== undefined) passwords.set(id, password)
  void window.api.files.addRecent(opened.path)
  void loadOutline(id)
  return id
}

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
  try {
    const outcome = await withPassword(name, (password) => engine.openDocument(path, password))
    if (!outcome) return false
    const opened = outcome.result

    // The engine reports the absolute path, which may be a file we have.
    const duplicate = findTabByPath(useTabs.getState().tabs, opened.path)
    if (duplicate) {
      void engine.closeDocument(opened.docId).catch(() => {})
      useTabs.getState().activateTab(duplicate.id)
      return true
    }
    showOpened(opened, outcome.password)
    return true
  } catch (error) {
    toast.error(`Could not open ${name}`, { description: describe(error) })
    if (error instanceof EngineApiError && error.code === 'file_not_found') {
      void window.api.files.removeRecent(path)
    }
    return false
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

// --- saving ------------------------------------------------------------------

/**
 * Saves the tab's document to its file, or with `saveAs` to a file the user
 * picks. Resolves to whether it was saved.
 */
export async function saveTab(tabId: string, saveAs = false): Promise<boolean> {
  const tab = getTab(tabId)
  if (!tab) return false

  let target: string | undefined
  if (saveAs) {
    const chosen = await window.api.files.showSaveDialog(tab.filePath)
    if (!chosen) return false
    const other = findTabByPath(useTabs.getState().tabs, chosen)
    if (other && other.id !== tabId) {
      toast.error(`Could not save as ${fileNameOf(chosen)}`, {
        description: 'That file is open in another tab. Close it there first.'
      })
      return false
    }
    target = chosen
  }

  try {
    const saved = await engine.save(tab.docId, target)
    if (getTab(tabId)?.docId !== tab.docId) return false
    useTabs.getState().applySaved(tabId, saved)
    void window.api.files.addRecent(saved.path)
    toast.success(`Saved ${saved.fileName}`, { duration: 2000 })
    return true
  } catch (error) {
    const name = target ? fileNameOf(target) : tab.fileName
    const canSaveAs = error instanceof EngineApiError && SAVE_AS_HELPS.has(error.code)
    toast.error(`Could not save ${name}`, {
      description: describe(error),
      action: canSaveAs
        ? { label: 'Save As…', onClick: () => void saveTab(tabId, true) }
        : undefined
    })
    return false
  }
}

// --- closing -------------------------------------------------------------------

function forgetDocument(tabId: string, docId: string): void {
  const search = searches.get(tabId)
  if (search) {
    clearTimeout(search.timer)
    search.abort?.abort()
    searches.delete(tabId)
  }
  pageImages.dropDocument(docId)
  pageTexts.dropDocument(docId)
  pageAnnotations.dropDocument(docId)
  pageBlocks.dropDocument(docId)
  const editing = useTools.getState().editing
  if (editing?.tabId === tabId) useTools.getState().setEditing(null)
}

/** Closes a tab without asking, dropping any unsaved changes. */
async function discardTab(tabId: string): Promise<void> {
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

/**
 * Closes a tab. If it has unsaved changes the user is asked whether to save
 * them first. Resolves to whether the tab was closed.
 */
export async function closeTab(tabId: string): Promise<boolean> {
  const tab = getTab(tabId)
  if (!tab) return true
  if (tab.history.modified && engineConnected()) {
    useTabs.getState().activateTab(tabId)
    const choice = await window.api.dialogs.confirmUnsaved(tab.fileName)
    if (choice === 'cancel') return false
    if (choice === 'save' && !(await saveTab(tabId))) return false
  }
  await discardTab(tabId)
  return true
}

let closingApp = false

/**
 * The window is closing or the app quitting: deal with every tab's unsaved
 * changes, then let main go ahead. Cancelling any question stops it.
 */
export async function requestAppClose(): Promise<void> {
  if (closingApp) return
  closingApp = true
  try {
    for (const tab of [...useTabs.getState().tabs]) {
      if (!(await closeTab(tab.id))) return
    }
    window.api.app.confirmClose()
  } finally {
    closingApp = false
  }
}

// --- recovery copies --------------------------------------------------------------

/** Opens a recovery copy in a new tab, with its changes unsaved. */
export async function restoreRecovery(entry: RecoveryEntry): Promise<boolean> {
  const existing = findTabByPath(useTabs.getState().tabs, entry.originalPath)
  if (existing) {
    toast.error(`Could not restore ${entry.fileName}`, {
      description: 'The file is open. Close it first.'
    })
    return false
  }
  try {
    const outcome = await withPassword(entry.fileName, (password) =>
      engine.restoreRecovery(entry.recoveryId, password)
    )
    if (!outcome) return false
    showOpened(outcome.result, outcome.password)
    return true
  } catch (error) {
    toast.error(`Could not restore ${entry.fileName}`, { description: describe(error) })
    return false
  }
}

export async function discardRecovery(entry: RecoveryEntry): Promise<void> {
  try {
    await engine.discardRecovery(entry.recoveryId)
  } catch {
    // Already gone.
  }
}

/** Offers the recovery copies left by an earlier run, if there are any. */
async function offerRecovery(): Promise<void> {
  try {
    const entries = await engine.recoveryEntries()
    if (entries.length > 0) useDialogs.setState({ recovery: entries })
  } catch {
    // Without the engine there is nothing to restore anyway.
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

/**
 * Opens every document again after the engine was replaced by a new process.
 * A document with unsaved changes comes back from its recovery copy if one
 * was written; otherwise from its file.
 */
async function reopenAll(): Promise<void> {
  const tabs = useTabs.getState().tabs
  if (tabs.length === 0) return
  const recovered: string[] = []
  const lost: string[] = []
  const failed: string[] = []

  let entries: RecoveryEntry[] = []
  try {
    entries = await engine.recoveryEntries()
  } catch {
    // Reopen from the files.
  }

  for (const tab of tabs) {
    forgetDocument(tab.id, tab.docId)
    const copy = tab.history.modified
      ? entries.find((entry) => findTabByPath([tab], entry.originalPath) !== null)
      : undefined
    try {
      const password = passwords.get(tab.id)
      const opened = copy
        ? await engine.restoreRecovery(copy.recoveryId, password)
        : await engine.openDocument(tab.filePath, password)
      if (!getTab(tab.id)) {
        void engine.closeDocument(opened.docId).catch(() => {})
        continue
      }
      if (copy) recovered.push(tab.fileName)
      else if (tab.history.modified) lost.push(tab.fileName)
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
  if (recovered.length > 0) {
    toast.warning('The PDF engine was restarted', {
      description:
        `Unsaved changes to ${recovered.join(', ')} were restored from the last recovery copy. ` +
        'Changes from the last two minutes may be missing.'
    })
  }
  if (lost.length > 0) {
    toast.warning('Unsaved changes were lost', {
      description: `The PDF engine was restarted and ${lost.join(', ')} was opened again from disk.`
    })
  }
}

function reportToMain(): void {
  const active = selectActiveTab(useTabs.getState())
  window.api.menu.setState({
    hasDocument: active !== null,
    layout: active?.layout ?? null,
    canUndo: active?.history.canUndo ?? false,
    canRedo: active?.history.canRedo ?? false,
    undoName: active?.history.undoName ?? null,
    redoName: active?.history.redoName ?? null,
    canDelete: active?.selectedAnnotation != null
  })
  document.title = active
    ? `${active.history.modified ? '*' : ''}${active.fileName} - ${APP_NAME}`
    : APP_NAME
}

/**
 * Connects the documents to the outside world: opens the files main asks
 * for, reopens documents after an engine restart, offers recovery copies,
 * answers main's close requests, and keeps the menu and the window title in
 * step with the active tab. Returns a function that undoes it.
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
  const unsubscribeClose = window.api.app.onCloseRequest(() => {
    // Without the engine nothing can be saved; there is nothing to ask.
    if (!engineConnected() || useTabs.getState().tabs.length === 0) window.api.app.confirmClose()
    else void requestAppClose()
  })
  void (async () => {
    // A page that starts afresh has no tabs, so whatever the engine still has
    // open belongs to a previous load of the page. Its unsaved changes are
    // kept as recovery copies, which are offered below with any others.
    await engine.closeAllDocuments().catch(() => {})
    if (stopped) return
    await openPaths(await window.api.files.takePending())
    if (stopped) return
    await offerRecovery()
  })()

  return () => {
    stopped = true
    unsubscribeEngine()
    unsubscribeTabs()
    unsubscribeOpen()
    unsubscribeClose()
  }
}
