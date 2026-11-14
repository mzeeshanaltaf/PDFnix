import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  IPC,
  type AppInfo,
  isFileChoice,
  isLayoutMode,
  isSaveKind,
  isThemeSource,
  type MenuState,
  type UnsavedChoice
} from '../shared/api'
import type { EngineManager } from './engine'
import {
  addRecent,
  chooseFiles,
  chooseFolder,
  clearRecent,
  listRecent,
  openExternally,
  removeRecent,
  showInFolder,
  showOpenDialog,
  showSaveDialog,
  takePending
} from './files'
import { setMenuState } from './menu'
import { listPrinters, printFile } from './print'
import { getUserSettings, setUserSettings } from './settings'
import {
  addSignature,
  listSignatures,
  removeSignature,
  renameSignature,
  setDefaultSignature
} from './signatures'
import { changeTheme, currentTheme } from './theme'

/**
 * The third-party licence notices (`pnpm notices` writes them to
 * resources/licenses; the installer ships them as resources/licenses).
 */
function noticesPath(): string {
  const folder = app.isPackaged
    ? join(process.resourcesPath, 'licenses')
    : join(app.getAppPath(), 'resources', 'licenses')
  return join(folder, 'THIRD-PARTY-NOTICES.txt')
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toMenuState(value: unknown): MenuState {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<MenuState>
  return {
    hasDocument: candidate.hasDocument === true,
    layout: isLayoutMode(candidate.layout) ? candidate.layout : null,
    canUndo: candidate.canUndo === true,
    canRedo: candidate.canRedo === true,
    undoName: text(candidate.undoName),
    redoName: text(candidate.redoName),
    canDelete: candidate.canDelete === true,
    canConvertWord: candidate.canConvertWord === true
  }
}

async function confirmUnsaved(
  window: BrowserWindow | null,
  fileName: unknown
): Promise<UnsavedChoice> {
  const name = typeof fileName === 'string' && fileName ? fileName : 'this document'
  const options = {
    type: 'warning' as const,
    title: app.getName(),
    message: `Do you want to save the changes to ${name}?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  }
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
}

/** Registers every IPC handler behind `window.api` and forwards engine status. */
export function registerIpc(engine: EngineManager, onConfirmClose: () => void): void {
  ipcMain.handle(IPC.engineGetConnection, () => engine.getConnection())
  ipcMain.handle(IPC.engineGetStatus, () => engine.getStatus())
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())
  ipcMain.handle(IPC.appGetInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    packaged: app.isPackaged
  }))
  ipcMain.handle(IPC.appOpenNotices, async () => {
    const path = noticesPath()
    if (!existsSync(path)) return false
    return (await shell.openPath(path)) === ''
  })
  ipcMain.on(IPC.appConfirmClose, () => onConfirmClose())
  ipcMain.handle(IPC.themeGet, () => currentTheme())
  ipcMain.handle(IPC.themeSet, (_event, theme: unknown) => {
    if (!isThemeSource(theme)) throw new Error(`Invalid theme: ${String(theme)}`)
    return changeTheme(theme)
  })
  ipcMain.handle(IPC.settingsGet, () => getUserSettings())
  ipcMain.handle(IPC.settingsSet, (_event, patch: unknown) => setUserSettings(patch))
  ipcMain.handle(IPC.dialogsConfirmUnsaved, (event, fileName: unknown) =>
    confirmUnsaved(BrowserWindow.fromWebContents(event.sender), fileName)
  )

  ipcMain.handle(IPC.filesShowOpenDialog, () => showOpenDialog())
  ipcMain.handle(
    IPC.filesShowSaveDialog,
    (_event, defaultPath: unknown, title: unknown, kind: unknown) =>
      showSaveDialog(defaultPath, title, isSaveKind(kind) ? kind : 'pdf')
  )
  ipcMain.handle(IPC.filesOpenExternally, (_event, path: unknown) => openExternally(path))
  ipcMain.handle(IPC.filesChoose, (_event, kind: unknown, title: unknown) =>
    isFileChoice(kind) ? chooseFiles(kind, title) : []
  )
  ipcMain.handle(IPC.filesChooseFolder, (_event, defaultPath: unknown, title: unknown) =>
    chooseFolder(defaultPath, title)
  )
  ipcMain.on(IPC.filesShowInFolder, (_event, path: unknown) => showInFolder(path))
  ipcMain.handle(IPC.filesTakePending, () => takePending())
  ipcMain.handle(IPC.filesGetRecent, () => listRecent())
  ipcMain.handle(IPC.filesAddRecent, (_event, path: unknown) => {
    if (typeof path === 'string') addRecent(path)
  })
  ipcMain.handle(IPC.filesRemoveRecent, (_event, path: unknown) => {
    if (typeof path === 'string') removeRecent(path)
  })
  ipcMain.handle(IPC.filesClearRecent, () => clearRecent())

  ipcMain.on(IPC.menuSetState, (_event, state: unknown) => setMenuState(toMenuState(state)))

  ipcMain.handle(IPC.printPrinters, () => listPrinters())
  ipcMain.handle(IPC.printPrint, (_event, request: unknown) => printFile(request))

  ipcMain.handle(IPC.signaturesList, () => listSignatures())
  ipcMain.handle(IPC.signaturesAdd, (_event, signature: unknown) => addSignature(signature))
  ipcMain.handle(IPC.signaturesRename, (_event, id: unknown, name: unknown) =>
    renameSignature(id, name)
  )
  ipcMain.handle(IPC.signaturesRemove, (_event, id: unknown) => removeSignature(id))
  ipcMain.handle(IPC.signaturesSetDefault, (_event, id: unknown) => setDefaultSignature(id))

  engine.on('status', (status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.engineStatus, status)
    }
  })
}
