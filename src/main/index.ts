import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { EngineManager, type EngineStartError } from './engine'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { applySavedTheme, onThemeChanged, windowBackground } from './theme'

const APP_ID = 'com.pdfnix.app'
const DEV_RENDERER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

// Development keeps its own settings and its own single-instance lock, so a
// dev session and an installed copy do not interfere with each other.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

let mainWindow: BrowserWindow | null = null
let engineDialogOpen = false

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
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window.show())
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
  // A second launch focuses the existing window. Handing over a file path
  // from the second launch is added in phase 2.
  app.on('second-instance', focusMainWindow)

  app.on('before-quit', () => engine.stop())
  // Last resort if the app exits without the normal quit sequence.
  process.on('exit', () => engine.stop())

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)

    applySavedTheme()
    registerIpc(engine)
    buildMenu(() => mainWindow)
    onThemeChanged(() => buildMenu(() => mainWindow))

    engine.on('failed', (error) => void showEngineFailure(error))

    mainWindow = createWindow()
    void engine.start().catch(() => {})
  })
}
