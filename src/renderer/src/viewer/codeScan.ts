/**
 * QR codes and barcodes of the open documents, found in the background.
 *
 * The engine decodes one page per request. The scanner asks for the pages of
 * the active tab one at a time, starting at the current page and wrapping
 * around, with a short pause between requests so page renders (which need the
 * same engine lock) keep flowing. Each page's result is stored with the page
 * revision it was found at; after an edit only the changed pages are scanned
 * again, and a result counts only while its revision is the page's current one.
 *
 * With the "look for codes automatically" setting off, a tab is only scanned
 * once something asks for it (`requestCodeScan`: the panel or the dialog).
 */

import { toast } from 'sonner'
import { create } from 'zustand'
import { engine, isAbortError, type PageCode } from '@/api/engine'
import { showCodes, useDialogs } from '@/state/dialogs'
import { useSettings } from '@/state/settings'
import { getActiveTab, useTabs, type DocumentTab } from '@/state/tabs'

export interface PageCodesResult {
  revision: number
  codes: PageCode[]
  /** The engine could not read the page; counts as scanned (with no codes). */
  failed?: boolean
}

export interface TabScan {
  /** The engine session the results belong to. */
  docId: string
  /** Per page index; `undefined` until the page has been scanned. */
  pages: (PageCodesResult | undefined)[]
  /** The user was told about the codes already (once per tab). */
  announced: boolean
  /** Asked for by the panel or dialog (matters when automatic scanning is off). */
  wanted: boolean
}

/** A code with the page it is on. */
export interface FoundCode {
  page: number
  /** Index of the code within its page. */
  index: number
  code: PageCode
}

export interface ScanProgress {
  scanned: number
  total: number
  done: boolean
}

/** A code to draw attention to on the page (after it was picked in a list). */
export interface CodeFlash {
  tabId: string
  page: number
  index: number
  /** Distinguishes flashes of the same code. */
  serial: number
}

interface CodeScanState {
  /** By tab id. */
  scans: Record<string, TabScan>
  flash: CodeFlash | null
}

export const useCodeScan = create<CodeScanState>(() => ({ scans: {}, flash: null }))

/** Pause between two page requests, so page renders get the engine in between. */
const GAP_MS = 60

function emptyScan(docId: string): TabScan {
  return { docId, pages: [], announced: false, wanted: false }
}

function isCurrent(
  result: PageCodesResult | undefined,
  tab: Pick<DocumentTab, 'pageRevisions' | 'revision'>,
  page: number
): result is PageCodesResult {
  return result !== undefined && result.revision === (tab.pageRevisions[page] ?? tab.revision)
}

/** The codes whose page has not changed since they were found, in page order. */
export function currentCodes(
  scan: TabScan | undefined,
  tab: Pick<DocumentTab, 'pageCount' | 'pageRevisions' | 'revision'>
): FoundCode[] {
  if (!scan) return []
  const found: FoundCode[] = []
  for (let page = 0; page < tab.pageCount; page++) {
    const result = scan.pages[page]
    if (!isCurrent(result, tab, page)) continue
    result.codes.forEach((code, index) => found.push({ page, index, code }))
  }
  return found
}

export function scanProgress(
  scan: TabScan | undefined,
  tab: Pick<DocumentTab, 'pageCount' | 'pageRevisions' | 'revision'>
): ScanProgress {
  let scanned = 0
  for (let page = 0; page < tab.pageCount; page++) {
    if (isCurrent(scan?.pages[page], tab, page)) scanned++
  }
  return { scanned, total: tab.pageCount, done: scanned === tab.pageCount }
}

/** The next page to scan: the first one from `tab.page` on (wrapping) without a current result. */
export function nextPageToScan(
  scan: TabScan | undefined,
  tab: Pick<DocumentTab, 'page' | 'pageCount' | 'pageRevisions' | 'revision'>
): number | null {
  const count = tab.pageCount
  if (count === 0) return null
  const start = Math.min(Math.max(tab.page, 0), count - 1)
  for (let step = 0; step < count; step++) {
    const page = (start + step) % count
    if (!isCurrent(scan?.pages[page], tab, page)) return page
  }
  return null
}

const QR_FORMATS = /QR/i

/** "2 QR codes", "1 barcode", "2 QR codes and 1 barcode". */
export function describeCodes(codes: readonly PageCode[]): string {
  const qr = codes.filter((code) => QR_FORMATS.test(code.format)).length
  const other = codes.length - qr
  const parts: string[] = []
  if (qr) parts.push(`${qr} QR code${qr === 1 ? '' : 's'}`)
  if (other) parts.push(`${other} barcode${other === 1 ? '' : 's'}`)
  return parts.join(' and ') || 'no codes'
}

// ---------------------------------------------------------------------------
// The scanner

interface InFlight {
  tabId: string
  docId: string
  controller: AbortController
}

let inFlight: InFlight | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function patchScan(tabId: string, change: (scan: TabScan) => TabScan): void {
  const { scans } = useCodeScan.getState()
  const current = scans[tabId]
  if (!current) return
  const next = change(current)
  if (next !== current) useCodeScan.setState({ scans: { ...scans, [tabId]: next } })
}

/** Makes sure every open tab has a scan entry for its current session, and no closed tab has one. */
function syncTabs(tabs: readonly DocumentTab[]): void {
  const { scans } = useCodeScan.getState()
  let changed = false
  const next: Record<string, TabScan> = {}
  for (const tab of tabs) {
    const scan = scans[tab.id]
    if (!scan) {
      next[tab.id] = emptyScan(tab.docId)
      changed = true
    } else if (scan.docId !== tab.docId) {
      // Reopened in a new engine session (engine restart): positions may differ.
      next[tab.id] = { ...emptyScan(tab.docId), announced: scan.announced, wanted: scan.wanted }
      changed = true
    } else {
      next[tab.id] = scan
    }
  }
  if (Object.keys(scans).length !== tabs.length) changed = true
  if (changed) useCodeScan.setState({ scans: next })

  if (
    inFlight &&
    !tabs.some((tab) => tab.id === inFlight!.tabId && tab.docId === inFlight!.docId)
  ) {
    inFlight.controller.abort()
    inFlight = null
  }
}

function schedule(): void {
  if (inFlight || timer) return
  timer = setTimeout(() => {
    timer = null
    step()
  }, GAP_MS)
}

function announce(tab: DocumentTab, scan: TabScan): void {
  if (scan.announced) return
  const codes = currentCodes(scan, tab).map((found) => found.code)
  if (codes.length === 0) return
  patchScan(tab.id, (current) => ({ ...current, announced: true }))
  // Someone looking at the results already needs no message.
  const panelOpen = tab.sidePanel.open && tab.sidePanel.panel === 'codes'
  if (panelOpen || useDialogs.getState().codesTabId === tab.id) return
  toast(`Found ${describeCodes(codes)}`, {
    description: tab.fileName,
    duration: 10000,
    action: { label: 'View', onClick: () => showCodes(tab.id) }
  })
}

function step(): void {
  if (inFlight) return
  const tab = getActiveTab()
  if (!tab) return
  const scan = useCodeScan.getState().scans[tab.id]
  if (!scan || scan.docId !== tab.docId) return
  if (!useSettings.getState().scanCodes && !scan.wanted) return

  const page = nextPageToScan(scan, tab)
  if (page === null) {
    announce(tab, scan)
    return
  }

  const revision = tab.pageRevisions[page] ?? tab.revision
  const { id: tabId, docId } = tab
  const controller = new AbortController()
  const request: InFlight = { tabId, docId, controller }
  inFlight = request

  const store = (result: PageCodesResult): void =>
    patchScan(tabId, (current) => {
      if (current.docId !== docId) return current
      const pages = current.pages.slice()
      pages[page] = result
      return { ...current, pages }
    })

  engine
    .pageCodes(docId, page, controller.signal)
    .then((found) => store({ revision, codes: found.codes }))
    .catch((error: unknown) => {
      if (isAbortError(error) || controller.signal.aborted) return
      console.warn('Could not look for codes on page', page + 1, error)
      store({ revision, codes: [], failed: true })
    })
    .finally(() => {
      if (inFlight === request) inFlight = null
      schedule()
    })
}

/** Scans the tab even when automatic scanning is off (the panel or dialog is showing it). */
export function requestCodeScan(tabId: string): void {
  patchScan(tabId, (scan) => (scan.wanted ? scan : { ...scan, wanted: true }))
  schedule()
}

/** Shows the code on its page and makes it blink. */
export function revealCode(tabId: string, found: FoundCode, reveal: () => void): void {
  reveal()
  const serial = (useCodeScan.getState().flash?.serial ?? 0) + 1
  useCodeScan.setState({ flash: { tabId, page: found.page, index: found.index, serial } })
}

/** Starts the background scanner; returns a function that stops it. */
export function startCodeScanner(): () => void {
  syncTabs(useTabs.getState().tabs)
  schedule()
  const stopTabs = useTabs.subscribe((state, previous) => {
    if (state.tabs !== previous.tabs) syncTabs(state.tabs)
    schedule()
  })
  const stopSettings = useSettings.subscribe((state, previous) => {
    if (state.scanCodes !== previous.scanCodes) schedule()
  })
  return () => {
    stopTabs()
    stopSettings()
    if (timer) clearTimeout(timer)
    timer = null
    inFlight?.controller.abort()
    inFlight = null
  }
}

/** The active tab's codes and progress, for the panel, dialog and page layer. */
export function useTabCodes(
  tab: Pick<DocumentTab, 'id' | 'pageCount' | 'pageRevisions' | 'revision'>
): { codes: FoundCode[]; progress: ScanProgress; scan: TabScan | undefined } {
  const scan = useCodeScan((state) => state.scans[tab.id])
  return { codes: currentCodes(scan, tab), progress: scanProgress(scan, tab), scan }
}
