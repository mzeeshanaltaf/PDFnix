import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
  IPC,
  isFileChoice,
  isLayoutMode,
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
  removeRecent,
  showInFolder,
  showOpenDialog,
  showSaveDialog,
  takePending
} from './files'
import { setMenuState } from './menu'
import { getUserSettings, setUserSettings } from './settings'
import {
  addSignature,
  listSignatures,
  removeSignature,
  renameSignature,
  setDefaultSignature
} from './signatures'
import { changeTheme, currentTheme } from './theme'

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
    canDelete: candidate.canDelete === true
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
  ipcMain.handle(IPC.filesShowSaveDialog, (_event, defaultPath: unknown, title: unknown) =>
    showSaveDialog(defaultPath, title)
  )
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
