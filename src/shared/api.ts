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
  'file.save',
  'file.saveAs',
  'file.closeTab',
  'file.properties',
  'file.preferences',
  'edit.undo',
  'edit.redo',
  'edit.delete',
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
  'go.lastPage',
  'tools.select',
  'tools.highlight',
  'tools.underline',
  'tools.strikeout',
  'tools.note'
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value)
}

/** What the menu needs to know about the renderer to enable and check its entries. */
export interface MenuState {
  hasDocument: boolean
  layout: LayoutMode | null
  canUndo: boolean
  canRedo: boolean
  /** Name of the step Undo would take back ("Highlight"), or null. */
  undoName: string | null
  redoName: string | null
  /** An annotation is selected, so Edit > Delete removes it. */
  canDelete: boolean
}

export const EMPTY_MENU_STATE: MenuState = {
  hasDocument: false,
  layout: null,
  canUndo: false,
  canRedo: false,
  undoName: null,
  redoName: null,
  canDelete: false
}

/** Settings the user can change. Persisted by main. */
export interface UserSettings {
  /** Written into the annotations the user creates. */
  authorName: string
  /** `#rrggbb`: the colour new highlights start with. */
  highlightColor: string
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

/** The answer to "Save changes to … before closing?". */
export type UnsavedChoice = 'save' | 'discard' | 'cancel'

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
    /**
     * The window is about to close or the app to quit. The renderer deals
     * with unsaved changes and then calls `confirmClose`; if it never does,
     * nothing closes (the user cancelled).
     */
    onCloseRequest(listener: () => void): Unsubscribe
    confirmClose(): void
  }
  settings: {
    get(): Promise<UserSettings>
    set(patch: Partial<UserSettings>): Promise<UserSettings>
  }
  dialogs: {
    /** The native "Save changes?" question for a document with unsaved changes. */
    confirmUnsaved(fileName: string): Promise<UnsavedChoice>
  }
  theme: {
    get(): Promise<ThemeSource>
    set(theme: ThemeSource): Promise<ThemeSource>
    onChange(listener: (theme: ThemeSource) => void): Unsubscribe
  }
  files: {
    /** Shows the Open dialog. Resolves with the chosen paths (none if cancelled). */
    showOpenDialog(): Promise<string[]>
    /** Shows the Save As dialog, starting at `defaultPath`. Null if cancelled. */
    showSaveDialog(defaultPath: string): Promise<string | null>
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
  appCloseRequest: 'app:closeRequest',
  appConfirmClose: 'app:confirmClose',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  dialogsConfirmUnsaved: 'dialogs:confirmUnsaved',
  filesShowSaveDialog: 'files:showSaveDialog',
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
