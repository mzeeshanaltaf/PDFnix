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
import type { AiEventMessage } from '../shared/ai'

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
    getVersion: () => ipcRenderer.invoke(IPC.appGetVersion),
    getInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
    openNotices: () => ipcRenderer.invoke(IPC.appOpenNotices),
    openLink: (url) => ipcRenderer.invoke(IPC.appOpenLink, url),
    onCloseRequest: (listener) => subscribe<void>(IPC.appCloseRequest, () => listener()),
    confirmClose: () => ipcRenderer.send(IPC.appConfirmClose)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  dialogs: {
    confirmUnsaved: (fileName) => ipcRenderer.invoke(IPC.dialogsConfirmUnsaved, fileName)
  },
  theme: {
    get: () => ipcRenderer.invoke(IPC.themeGet),
    set: (theme) => ipcRenderer.invoke(IPC.themeSet, theme),
    onChange: (listener) => subscribe<ThemeSource>(IPC.themeChanged, listener)
  },
  files: {
    showOpenDialog: () => ipcRenderer.invoke(IPC.filesShowOpenDialog),
    showSaveDialog: (defaultPath, title, kind) =>
      ipcRenderer.invoke(IPC.filesShowSaveDialog, defaultPath, title, kind),
    choose: (kind, title) => ipcRenderer.invoke(IPC.filesChoose, kind, title),
    chooseFolder: (defaultPath, title) =>
      ipcRenderer.invoke(IPC.filesChooseFolder, defaultPath, title),
    showInFolder: (path) => ipcRenderer.send(IPC.filesShowInFolder, path),
    openExternally: (path) => ipcRenderer.invoke(IPC.filesOpenExternally, path),
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
  },
  print: {
    printers: () => ipcRenderer.invoke(IPC.printPrinters),
    print: (request) => ipcRenderer.invoke(IPC.printPrint, request)
  },
  ai: {
    listModels: () => ipcRenderer.invoke(IPC.aiListModels),
    chat: (request) => ipcRenderer.invoke(IPC.aiChat, request),
    cancel: (requestId) => ipcRenderer.send(IPC.aiCancel, { requestId }),
    onEvent: (listener) => subscribe<AiEventMessage>(IPC.aiEvent, listener)
  },
  signatures: {
    list: () => ipcRenderer.invoke(IPC.signaturesList),
    add: (signature) => ipcRenderer.invoke(IPC.signaturesAdd, signature),
    rename: (id, name) => ipcRenderer.invoke(IPC.signaturesRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.signaturesRemove, id),
    setDefault: (id) => ipcRenderer.invoke(IPC.signaturesSetDefault, id)
  }
}

contextBridge.exposeInMainWorld('api', api)
