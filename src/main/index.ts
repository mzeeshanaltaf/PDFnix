import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { EngineManager, type EngineStartError } from './engine'
import appIcon from '../../build/icon.ico?asset'
import { IPC } from '../shared/api'
import {
  initFiles,
  isRendererReady,
  onRecentChanged,
  openFromArgv,
  rendererIsLoading
} from './files'
import { registerIpc } from './ipc'
import { buildMenu, initMenu } from './menu'
import { applySavedTheme, onThemeChanged, windowBackground } from './theme'

const APP_ID = 'com.pdfnix.app'
const DEV_RENDERER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

// Development keeps its own settings and its own single-instance lock, so a
// dev session and an installed copy do not interfere with each other.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}
// End-to-end tests run against a throwaway profile (settings, recovery copies,
// signatures, single-instance lock) so they never touch a real one.
if (process.env['PDFNIX_USER_DATA']) {
  app.setPath('userData', process.env['PDFNIX_USER_DATA'])
}

let mainWindow: BrowserWindow | null = null
let engineDialogOpen = false
/** The renderer has dealt with unsaved changes; closing may go ahead. */
let closeConfirmed = false

/**
 * Asks the renderer to deal with unsaved changes before the window closes.
 * Returns false if it cannot be asked (not loaded, crashed), in which case
 * the window simply closes.
 */
function askRendererToClose(window: BrowserWindow): boolean {
  if (closeConfirmed || window.isDestroyed()) return false
  const contents = window.webContents
  if (contents.isCrashed() || contents.isLoading() || !isRendererReady()) return false
  contents.send(IPC.appCloseRequest)
  return true
}

/** The renderer says closing is fine (changes saved or deliberately dropped). */
function confirmClose(): void {
  closeConfirmed = true
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  else app.quit()
}

function rendererOrigins(): string[] {
  // A page loaded from file:// sends the origin "null".
  return [DEV_RENDERER_URL ? new URL(DEV_RENDERER_URL).origin : 'null']
}

const engine = new EngineManager(rendererOrigins())

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: app.getName(),
    // Without this, an unpackaged run shows Electron's own logo in the title
    // bar and taskbar; the installed exe already carries the same icon.
    icon: appIcon,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (askRendererToClose(window)) event.preventDefault()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // The window only ever shows the app itself: links open in the browser and
  // nothing (including a dropped file) may navigate it elsewhere.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  // While the page (re)loads it cannot take open requests; they are queued
  // until it asks for them.
  window.webContents.on('did-start-loading', rendererIsLoading)

  if (DEV_RENDERER_URL) {
    void window.loadURL(DEV_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function showEngineFailure(error: EngineStartError): Promise<void> {
  if (engineDialogOpen) return
  engineDialogOpen = true
  try {
    const options = {
      type: 'error' as const,
      title: `${app.getName()} engine`,
      message: 'The PDF engine is not running.',
      detail: [error.message, error.stderr.trim() && `\nEngine output:\n${error.stderr.trim()}`]
        .filter(Boolean)
        .join('\n'),
      buttons: ['Try Again', 'Continue Without Engine', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    if (response === 0) void engine.start().catch(() => {})
    else if (response === 2) app.quit()
  } finally {
    engineDialogOpen = false
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A second launch focuses the existing window and hands over the files it
  // was started with.
  app.on('second-instance', (_event, argv, workingDirectory) => {
    focusMainWindow()
    openFromArgv(argv, workingDirectory)
  })

  // File > Exit and other quits go through the same unsaved-changes check
  // as closing the window. The engine is only stopped once quitting is certain.
  app.on('before-quit', (event) => {
    if (mainWindow && askRendererToClose(mainWindow)) event.preventDefault()
  })
  app.on('will-quit', () => engine.stop())
  // Last resort if the app exits without the normal quit sequence.
  process.on('exit', () => engine.stop())

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)

    applySavedTheme()
    initFiles(() => mainWindow)
    registerIpc(engine, confirmClose)
    initMenu(() => mainWindow)
    onThemeChanged(buildMenu)
    onRecentChanged(buildMenu)

    engine.on('failed', (error) => void showEngineFailure(error))

    mainWindow = createWindow()
    void engine.start().catch(() => {})

    // Files named on the command line wait until the renderer asks for them.
    openFromArgv(process.argv, process.cwd())
  })
}
