import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC, isThemeSource } from '../shared/api'
import type { EngineManager } from './engine'
import { changeTheme, currentTheme } from './theme'

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

  engine.on('status', (status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.engineStatus, status)
    }
  })
}
