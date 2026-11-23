import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenedDocument, PageCode, PageCodes } from '../api/engine'

const engineMock = vi.hoisted(() => ({ pageCodes: vi.fn() }))
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))

vi.mock('@/api/engine', () => ({
  engine: engineMock,
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
}))
vi.mock('sonner', () => ({ toast: toastMock }))

import { useDialogs } from '@/state/dialogs'
import { useSettings } from '@/state/settings'
import { useTabs } from '@/state/tabs'
import {
  currentCodes,
  describeCodes,
  nextPageToScan,
  requestCodeScan,
  scanProgress,
  startCodeScanner,
  useCodeScan,
  type TabScan
} from './codeScan'

function code(text: string, format = 'QR Code'): PageCode {
  return {
    format,
    text,
    binary: false,
    quad: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10]
    ],
    rect: [0, 0, 10, 10]
  }
}

function opened(pageCount: number, docId = 'doc-1'): OpenedDocument {
  return {
    docId,
    path: 'C:\\Docs\\bill.pdf',
    fileName: 'bill.pdf',
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

type TabShape = Parameters<typeof nextPageToScan>[1]

const tab = (page: number, pageRevisions: number[]): TabShape => ({
  page,
  pageCount: pageRevisions.length,
  pageRevisions,
  revision: Math.max(0, ...pageRevisions)
})

function scanOf(pages: TabScan['pages']): TabScan {
  return { docId: 'doc-1', pages, announced: false, wanted: false }
}

describe('scan bookkeeping', () => {
  it('starts at the current page and wraps around', () => {
    const scan = scanOf([{ revision: 0, codes: [] }, undefined, { revision: 0, codes: [] }])
    expect(nextPageToScan(scan, tab(2, [0, 0, 0]))).toBe(1)
    expect(nextPageToScan(undefined, tab(2, [0, 0, 0]))).toBe(2)
    expect(nextPageToScan(scanOf([]), tab(0, []))).toBeNull()
  })

  it('treats a page changed since its scan as not scanned', () => {
    const scan = scanOf([
      { revision: 0, codes: [code('a')] },
      { revision: 0, codes: [code('b')] }
    ])
    const edited = tab(0, [0, 3])

    expect(nextPageToScan(scan, edited)).toBe(1)
    expect(currentCodes(scan, edited).map((found) => found.code.text)).toEqual(['a'])
    expect(scanProgress(scan, edited)).toEqual({ scanned: 1, total: 2, done: false })
  })

  it('lists codes in page order with their index on the page', () => {
    const scan = scanOf([
      { revision: 0, codes: [code('a'), code('b')] },
      { revision: 0, codes: [] },
      { revision: 0, codes: [code('c')] }
    ])
    expect(currentCodes(scan, tab(0, [0, 0, 0])).map(({ page, index }) => [page, index])).toEqual([
      [0, 0],
      [0, 1],
      [2, 0]
    ])
  })

  it('describes what was found', () => {
    expect(describeCodes([code('a')])).toBe('1 QR code')
    expect(describeCodes([code('a'), code('b', 'Micro QR Code'), code('c', 'Code 128')])).toBe(
      '2 QR codes and 1 barcode'
    )
    expect(describeCodes([code('a', 'Data Matrix'), code('b', 'EAN-13')])).toBe('2 barcodes')
  })
})

describe('background scanner', () => {
  let stop: () => void = () => {}

  beforeEach(() => {
    vi.useFakeTimers()
    engineMock.pageCodes.mockReset()
    toastMock.mockClear()
    useTabs.setState({ tabs: [], activeTabId: null })
    useCodeScan.setState({ scans: {}, flash: null })
    useDialogs.setState({ codesTabId: null })
    useSettings.setState({ scanCodes: true })
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('scans every page once, one at a time, and announces the codes once', async () => {
    const asked: number[] = []
    engineMock.pageCodes.mockImplementation(
      async (_docId: string, page: number): Promise<PageCodes> => {
        asked.push(page)
        return { codes: page === 1 ? [code('https://example.com')] : [] }
      }
    )
    const id = useTabs.getState().addTab(opened(3))
    useTabs.getState().setPage(id, 1)
    stop = startCodeScanner()

    await vi.advanceTimersByTimeAsync(1000)

    expect(asked).toEqual([1, 2, 0])
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][0]).toBe('Found 1 QR code')

    // Scrolling about does not scan again or announce again.
    useTabs.getState().setPage(id, 2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked).toEqual([1, 2, 0])
    expect(toastMock).toHaveBeenCalledTimes(1)
  })

  it('rescans only the pages an edit changed', async () => {
    const asked: number[] = []
    engineMock.pageCodes.mockImplementation(async (_docId: string, page: number) => {
      asked.push(page)
      return { codes: [] }
    })
    const id = useTabs.getState().addTab(opened(3))
    stop = startCodeScanner()
    await vi.advanceTimersByTimeAsync(1000)
    asked.length = 0

    useTabs.getState().applyMutation(id, {
      revision: 5,
      pageCount: 3,
      pages: [],
      dirtyPages: [2],
      structure: false,
      canUndo: true,
      canRedo: false,
      undoName: 'Highlight',
      redoName: null,
      modified: true
    } as unknown as Parameters<ReturnType<typeof useTabs.getState>['applyMutation']>[1])
    await vi.advanceTimersByTimeAsync(1000)

    expect(asked).toEqual([2])
  })

  it('waits to be asked when automatic scanning is off', async () => {
    engineMock.pageCodes.mockResolvedValue({ codes: [code('x')] })
    useSettings.setState({ scanCodes: false })
    const id = useTabs.getState().addTab(opened(2))
    stop = startCodeScanner()
    await vi.advanceTimersByTimeAsync(1000)
    expect(engineMock.pageCodes).not.toHaveBeenCalled()

    requestCodeScan(id)
    await vi.advanceTimersByTimeAsync(1000)
    expect(engineMock.pageCodes).toHaveBeenCalledTimes(2)
  })

  it('does not announce codes while the results are on screen', async () => {
    engineMock.pageCodes.mockResolvedValue({ codes: [code('x')] })
    const id = useTabs.getState().addTab(opened(1))
    useDialogs.setState({ codesTabId: id })
    stop = startCodeScanner()
    await vi.advanceTimersByTimeAsync(1000)

    expect(toastMock).not.toHaveBeenCalled()
  })

  it('stops asking about a document that was closed', async () => {
    let signal: AbortSignal | undefined
    engineMock.pageCodes.mockImplementation(
      (_docId: string, _page: number, given: AbortSignal) =>
        new Promise(() => {
          signal = given
        })
    )
    const id = useTabs.getState().addTab(opened(3))
    stop = startCodeScanner()
    await vi.advanceTimersByTimeAsync(200)
    expect(signal?.aborted).toBe(false)

    useTabs.getState().removeTab(id)

    expect(signal?.aborted).toBe(true)
    expect(useCodeScan.getState().scans).toEqual({})
  })
})
