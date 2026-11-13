import { BrowserWindow, dialog } from 'electron'
import { existsSync, statSync } from 'fs'
import { IPC, type RecentFile } from '../shared/api'
import {
  addToRecent,
  pdfPathsFromArgv,
  removeFromRecent,
  samePath,
  toRecentFile
} from './file-paths'
import { getRecentFiles, setRecentFiles } from './settings'

/**
 * Everything that opens a document ends up in `openFiles`: the Open dialog,
 * the recent-files menu, a path on the command line and a second launch.
 * (A file dropped on the window is already in the renderer, which opens it
 * the same way it opens the paths sent from here.)
 *
 * Main does not read PDFs. It hands paths to the renderer, which asks the
 * engine to open them.
 */

type RecentListener = (files: RecentFile[]) => void

let getWindow: () => BrowserWindow | null = () => null
/** False until the renderer has asked for the pending files. */
let rendererReady = false
let pending: string[] = []
const recentListeners = new Set<RecentListener>()

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function initFiles(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
}

/** Call when the window starts loading its page: requests are queued until it asks. */
export function rendererIsLoading(): void {
  rendererReady = false
}

/** Asks the renderer to open these files, now or as soon as it is ready. */
export function openFiles(paths: readonly string[]): void {
  const files = paths.filter(isFile)
  if (files.length === 0) return

  const window = getWindow()
  if (rendererReady && window && !window.isDestroyed()) {
    window.webContents.send(IPC.filesOpenRequest, files)
    return
  }
  for (const file of files) {
    if (!pending.some((known) => samePath(known, file))) pending.push(file)
  }
}

/** Opens the PDFs named on a command line (`argv[0]` is the executable). */
export function openFromArgv(argv: readonly string[], cwd: string): void {
  openFiles(pdfPathsFromArgv(argv, cwd))
}

/** The renderer is ready: hand over what was queued and send directly from now on. */
export function takePending(): string[] {
  rendererReady = true
  const files = pending
  pending = []
  return files
}

export async function showOpenDialog(): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    title: 'Open PDF',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'PDF documents', extensions: ['pdf'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  const window = getWindow()
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

/** File > Open: show the dialog and open what was chosen. */
export async function openWithDialog(): Promise<void> {
  openFiles(await showOpenDialog())
}

// --- recent files ----------------------------------------------------------

function publishRecent(paths: string[]): RecentFile[] {
  const files = paths.map(toRecentFile)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.filesRecentChanged, files)
  }
  for (const listener of recentListeners) listener(files)
  return files
}

/** The recent files that still exist. Files that have gone are dropped for good. */
export function listRecent(): RecentFile[] {
  const stored = getRecentFiles()
  const existing = stored.filter((path) => existsSync(path))
  if (existing.length !== stored.length) setRecentFiles(existing)
  return existing.map(toRecentFile)
}

export function addRecent(path: string): void {
  if (typeof path !== 'string' || !isFile(path)) return
  const updated = addToRecent(getRecentFiles(), path).filter((entry) => existsSync(entry))
  setRecentFiles(updated)
  publishRecent(updated)
}

export function removeRecent(path: string): void {
  if (typeof path !== 'string') return
  const updated = removeFromRecent(getRecentFiles(), path)
  setRecentFiles(updated)
  publishRecent(updated)
}

export function clearRecent(): void {
  setRecentFiles([])
  publishRecent([])
}

export function onRecentChanged(listener: RecentListener): void {
  recentListeners.add(listener)
}
