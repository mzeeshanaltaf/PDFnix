import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, statSync } from 'fs'
import {
  EXTERNAL_EXTENSIONS,
  IPC,
  type FileChoice,
  type RecentFile,
  type SaveKind
} from '../shared/api'
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

/** The renderer has loaded and taken its pending files, so it can be asked things. */
export function isRendererReady(): boolean {
  return rendererReady
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

const CHOICES: Record<FileChoice, { filter: Electron.FileFilter; title: string; many: boolean }> = {
  pdf: { filter: { name: 'PDF documents', extensions: ['pdf'] }, title: 'Choose PDF', many: false },
  pdfs: {
    filter: { name: 'PDF documents', extensions: ['pdf'] },
    title: 'Choose PDFs',
    many: true
  },
  image: {
    filter: { name: 'Pictures (PNG, JPEG)', extensions: ['png', 'jpg', 'jpeg'] },
    title: 'Choose Picture',
    many: false
  },
  images: {
    filter: {
      name: 'Pictures (PNG, JPEG, TIFF, BMP, GIF)',
      extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif']
    },
    title: 'Choose Pictures',
    many: true
  },
  word: {
    filter: {
      name: 'Word documents',
      extensions: ['docx', 'doc', 'docm', 'dotx', 'dot', 'rtf', 'odt']
    },
    title: 'Choose Word Document',
    many: false
  }
}

/** Open dialog for one PDF, several PDFs, pictures or a Word document. */
export async function chooseFiles(kind: FileChoice, title: unknown): Promise<string[]> {
  const choice = CHOICES[kind]
  const options: Electron.OpenDialogOptions = {
    title: typeof title === 'string' && title ? title : choice.title,
    properties: choice.many ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [choice.filter, { name: 'All files', extensions: ['*'] }]
  }
  const window = getWindow()
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

/** Folder picker. Null if the user cancelled. */
export async function chooseFolder(defaultPath: unknown, title: unknown): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: typeof title === 'string' && title ? title : 'Choose Folder',
    defaultPath: typeof defaultPath === 'string' && defaultPath ? defaultPath : undefined,
    properties: ['openDirectory', 'createDirectory']
  }
  const window = getWindow()
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

/** Shows a written file in Explorer. Only existing files. */
export function showInFolder(path: unknown): void {
  if (typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path)
}

const SAVE_FILTERS: Record<SaveKind, Electron.FileFilter> = {
  pdf: { name: 'PDF documents', extensions: ['pdf'] },
  docx: { name: 'Word documents', extensions: ['docx'] },
  txt: { name: 'Text files', extensions: ['txt'] }
}

/** Save As: where to write a file. Null if the user cancelled. */
export async function showSaveDialog(
  defaultPath: unknown,
  title?: unknown,
  kind: SaveKind = 'pdf'
): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    title: typeof title === 'string' && title ? title : 'Save As',
    defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
    filters: [SAVE_FILTERS[kind]],
    properties: ['showOverwriteConfirmation']
  }
  const window = getWindow()
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  // Windows adds the extension from the filter, but a typed "name." can slip through.
  const extension = `.${kind}`
  return result.filePath.toLowerCase().endsWith(extension)
    ? result.filePath
    : `${result.filePath}${extension}`
}

/**
 * Opens a file PDFnix wrote in the program Windows uses for it. Only the kinds
 * of files PDFnix writes, so a renderer cannot start programs.
 */
export async function openExternally(path: unknown): Promise<void> {
  if (typeof path !== 'string' || !existsSync(path)) throw new Error('The file does not exist.')
  const lower = path.toLowerCase()
  if (!EXTERNAL_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw new Error('PDFnix does not open this kind of file.')
  }
  const failure = await shell.openPath(path)
  if (failure) throw new Error(failure)
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
  // Windows' own list: the taskbar jump list and Start's recent files. It
  // only lists files of a type the app is registered for (the installer
  // associates .pdf), so it shows nothing in development.
  if (process.platform === 'win32') app.addRecentDocument(path)
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
  if (process.platform === 'win32') app.clearRecentDocuments()
}

export function onRecentChanged(listener: RecentListener): void {
  recentListeners.add(listener)
}
