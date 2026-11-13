import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC, isLayoutMode, isThemeSource, type MenuState } from '../shared/api'
import type { EngineManager } from './engine'
import {
  addRecent,
  clearRecent,
  listRecent,
  removeRecent,
  showOpenDialog,
  takePending
} from './files'
import { setMenuState } from './menu'
import { changeTheme, currentTheme } from './theme'

function toMenuState(value: unknown): MenuState {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<MenuState>
  return {
    hasDocument: candidate.hasDocument === true,
    layout: isLayoutMode(candidate.layout) ? candidate.layout : null
  }
}

/** Registers every IPC handler behind `window.api` and forwards engine status. */
export function registerIpc(engine: EngineManager): void {
  ipcMain.handle(IPC.engineGetConnection, () => engine.getConnection())
  ipcMain.handle(IPC.engineGetStatus, () => engine.getStatus())
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())
  ipcMain.handle(IPC.themeGet, () => currentTheme())
  ipcMain.handle(IPC.themeSet, (_event, theme: unknown) => {
    if (!isThemeSource(theme)) throw new Error(`Invalid theme: ${String(theme)}`)
    return changeTheme(theme)
  })

  ipcMain.handle(IPC.filesShowOpenDialog, () => showOpenDialog())
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

  engine.on('status', (status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.engineStatus, status)
    }
  })
}
