/**
 * Types shared by the main process, the preload script and the renderer.
 * This file must stay free of runtime imports from Electron or Node.
 */

export type ThemeSource = 'system' | 'light' | 'dark'

export const THEME_SOURCES: readonly ThemeSource[] = ['system', 'light', 'dark']

export function isThemeSource(value: unknown): value is ThemeSource {
  return typeof value === 'string' && (THEME_SOURCES as readonly string[]).includes(value)
}

/** Where the engine is listening and the secret that must accompany every request. */
export interface EngineConnection {
  baseUrl: string
  token: string
}

/**
 * - `starting`: first launch, not ready yet
 * - `ready`: accepting requests
 * - `restarting`: exited unexpectedly, a replacement is being started
 * - `failed`: could not be started; `message` says why
 * - `stopped`: shut down on purpose (app is quitting)
 */
export type EngineState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped'

export interface EngineStatus {
  state: EngineState
  /** Increases every time a new engine process becomes ready. */
  generation: number
  /** Number of unexpected exits recovered from since the app started. */
  restarts: number
  message?: string
}

/** How pages are arranged in the viewer. */
export type LayoutMode = 'continuous' | 'single' | 'two-page'

export const LAYOUT_MODES: readonly LayoutMode[] = ['continuous', 'single', 'two-page']

export function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === 'string' && (LAYOUT_MODES as readonly string[]).includes(value)
}

/** An entry of the recent-files list. */
export interface RecentFile {
  /** Absolute path. */
  path: string
  /** File name without the folder. */
  name: string
  /** The folder the file is in. */
  folder: string
}

/**
 * Commands the application menu sends to the renderer. The renderer runs the
 * same commands from the toolbar and from keyboard shortcuts.
 */
export const MENU_COMMANDS = [
  'file.closeTab',
  'file.properties',
  'edit.find',
  'edit.findNext',
  'edit.findPrevious',
  'view.zoomIn',
  'view.zoomOut',
  'view.actualSize',
  'view.fitWidth',
  'view.fitPage',
  'view.rotateCw',
  'view.rotateCcw',
  'view.rotateAllCw',
  'view.rotateAllCcw',
  'view.toggleSidePanel',
  'view.layout.continuous',
  'view.layout.single',
  'view.layout.two-page',
  'go.nextPage',
  'go.previousPage',
  'go.firstPage',
  'go.lastPage'
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]

/** What the menu needs to know about the renderer to enable and check its entries. */
export interface MenuState {
  hasDocument: boolean
  layout: LayoutMode | null
}

export type Unsubscribe = () => void

/** The API the preload script exposes to the renderer as `window.api`. */
export interface Api {
  engine: {
    /** Resolves once the engine is ready; rejects if it could not be started. */
    getConnection(): Promise<EngineConnection>
    getStatus(): Promise<EngineStatus>
    onStatus(listener: (status: EngineStatus) => void): Unsubscribe
  }
  app: {
    getVersion(): Promise<string>
  }
  theme: {
    get(): Promise<ThemeSource>
    set(theme: ThemeSource): Promise<ThemeSource>
    onChange(listener: (theme: ThemeSource) => void): Unsubscribe
  }
  files: {
    /** Shows the Open dialog. Resolves with the chosen paths (none if cancelled). */
    showOpenDialog(): Promise<string[]>
    /** The path on disk of a dropped file, or '' if it has none. */
    pathForFile(file: File): string
    /**
     * Tells main the renderer can take open requests and returns the paths
     * that were asked for before it could (command line, second launch).
     */
    takePending(): Promise<string[]>
    /** Main asks for these files to be opened (menu, second launch). */
    onOpenRequest(listener: (paths: string[]) => void): Unsubscribe
    getRecent(): Promise<RecentFile[]>
    addRecent(path: string): Promise<void>
    removeRecent(path: string): Promise<void>
    clearRecent(): Promise<void>
    onRecentChanged(listener: (files: RecentFile[]) => void): Unsubscribe
  }
  menu: {
    onCommand(listener: (command: MenuCommand) => void): Unsubscribe
    setState(state: MenuState): void
  }
}

/** IPC channel names, kept in one place so main and preload cannot drift apart. */
export const IPC = {
  engineGetConnection: 'engine:getConnection',
  engineGetStatus: 'engine:getStatus',
  engineStatus: 'engine:status',
  appGetVersion: 'app:getVersion',
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  themeChanged: 'theme:changed',
  filesShowOpenDialog: 'files:showOpenDialog',
  filesTakePending: 'files:takePending',
  filesOpenRequest: 'files:openRequest',
  filesGetRecent: 'files:getRecent',
  filesAddRecent: 'files:addRecent',
  filesRemoveRecent: 'files:removeRecent',
  filesClearRecent: 'files:clearRecent',
  filesRecentChanged: 'files:recentChanged',
  menuCommand: 'menu:command',
  menuSetState: 'menu:setState'
} as const
