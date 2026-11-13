import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type Api,
  type EngineStatus,
  type MenuCommand,
  type RecentFile,
  type ThemeSource,
  type Unsubscribe
} from '../shared/api'

function subscribe<T>(channel: string, listener: (value: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// A small, typed surface. Nothing generic (no raw ipcRenderer) is exposed.
const api: Api = {
  engine: {
    getConnection: () => ipcRenderer.invoke(IPC.engineGetConnection),
    getStatus: () => ipcRenderer.invoke(IPC.engineGetStatus),
    onStatus: (listener) => subscribe<EngineStatus>(IPC.engineStatus, listener)
  },
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.appGetVersion)
  },
  theme: {
    get: () => ipcRenderer.invoke(IPC.themeGet),
    set: (theme) => ipcRenderer.invoke(IPC.themeSet, theme),
    onChange: (listener) => subscribe<ThemeSource>(IPC.themeChanged, listener)
  },
  files: {
    showOpenDialog: () => ipcRenderer.invoke(IPC.filesShowOpenDialog),
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },
    takePending: () => ipcRenderer.invoke(IPC.filesTakePending),
    onOpenRequest: (listener) => subscribe<string[]>(IPC.filesOpenRequest, listener),
    getRecent: () => ipcRenderer.invoke(IPC.filesGetRecent),
    addRecent: (path) => ipcRenderer.invoke(IPC.filesAddRecent, path),
    removeRecent: (path) => ipcRenderer.invoke(IPC.filesRemoveRecent, path),
    clearRecent: () => ipcRenderer.invoke(IPC.filesClearRecent),
    onRecentChanged: (listener) => subscribe<RecentFile[]>(IPC.filesRecentChanged, listener)
  },
  menu: {
    onCommand: (listener) => subscribe<MenuCommand>(IPC.menuCommand, listener),
    setState: (state) => ipcRenderer.send(IPC.menuSetState, state)
  }
}

contextBridge.exposeInMainWorld('api', api)
