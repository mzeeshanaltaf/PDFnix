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

/** What the About dialog shows about the app itself. */
export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  /** Running from an installation, not from the development build. */
  packaged: boolean
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
  'file.print',
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
  'tools.note',
  'tools.hand',
  'tools.text',
  'tools.editText',
  'tools.image',
  'tools.shape',
  'tools.draw',
  'tools.deleteObject',
  'tools.sign',
  'tools.initials',
  'tools.initialsAllPages',
  'tools.manageSignatures',
  'tools.redact',
  'document.organise',
  'document.insertBlank',
  'document.insertFromFile',
  'document.extract',
  'document.split',
  'document.merge',
  'document.redact',
  'document.watermark',
  'document.headerFooter',
  'forms.highlight',
  'forms.reset',
  'forms.flatten',
  'tools.compress',
  'tools.protect',
  'tools.ocr',
  'tools.ocrLanguages',
  'convert.toWord',
  'convert.toImages',
  'convert.toText',
  'convert.imagesToPdf',
  'convert.wordToPdf',
  'help.shortcuts',
  'help.about'
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
  /** Microsoft Word or LibreOffice was found, so Word documents can be converted. */
  canConvertWord: boolean
}

export const EMPTY_MENU_STATE: MenuState = {
  hasDocument: false,
  layout: null,
  canUndo: false,
  canRedo: false,
  undoName: null,
  redoName: null,
  canDelete: false,
  canConvertWord: false
}

/** Settings the user can change. Persisted by main. */
export interface UserSettings {
  /** Written into the annotations the user creates. */
  authorName: string
  /** `#rrggbb`: the colour new highlights start with. */
  highlightColor: string
  /** How a newly opened document is zoomed. */
  defaultZoom: DefaultZoom
  /** How a newly opened document's pages are laid out. */
  defaultLayout: LayoutMode
  /** Tesseract language codes the OCR dialog starts with (1–3). */
  ocrLanguages: string[]
  /** Minutes an unsaved change may go without a recovery copy. */
  recoveryMinutes: number
}

export type DefaultZoom = 'fit-width' | 'fit-page' | 'actual-size'

export const DEFAULT_ZOOMS: readonly DefaultZoom[] = ['fit-width', 'fit-page', 'actual-size']

export function isDefaultZoom(value: unknown): value is DefaultZoom {
  return typeof value === 'string' && (DEFAULT_ZOOMS as readonly string[]).includes(value)
}

export const RECOVERY_MINUTES = { min: 1, max: 30, default: 2 } as const
export const MAX_OCR_LANGUAGES = 3

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

export type SignatureKind = 'signature' | 'initials'

/** A signature or initials in the user's library. */
export interface SignatureEntry {
  id: string
  kind: SignatureKind
  name: string
  /** Offered first when signing. One per kind at most. */
  isDefault: boolean
  /** Transparent PNG, base64. */
  png: string
  /** Pixel size of the PNG. */
  width: number
  height: number
  /** ISO 8601. */
  createdAt: string
}

export interface NewSignature {
  kind: SignatureKind
  name: string
  /** PNG, base64. */
  png: string
}

/** The answer to "Save changes to … before closing?". */
export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/**
 * What `files.choose` asks for: one PDF, several PDFs, one picture to place
 * (PNG/JPEG), several pictures to make a PDF of, or one Word document.
 */
export type FileChoice = 'pdf' | 'pdfs' | 'image' | 'images' | 'word'

export function isFileChoice(value: unknown): value is FileChoice {
  return (
    value === 'pdf' ||
    value === 'pdfs' ||
    value === 'image' ||
    value === 'images' ||
    value === 'word'
  )
}

/** What a Save dialog saves: a PDF, a Word document or plain text. */
export type SaveKind = 'pdf' | 'docx' | 'txt'

export function isSaveKind(value: unknown): value is SaveKind {
  return value === 'pdf' || value === 'docx' || value === 'txt'
}

/** Files PDFnix writes that `files.openExternally` may open in their own program. */
export const EXTERNAL_EXTENSIONS = ['.pdf', '.docx', '.txt', '.png', '.jpg'] as const

/** A printer, as the Print dialog lists it. */
export interface PrinterInfo {
  name: string
  isDefault: boolean
  /** The printer says it can print on both sides. */
  duplex: boolean
  color: boolean
}

export interface PrintRequest {
  /** The temporary file the engine wrote (`POST /docs/{id}/print-file`); deleted after printing. */
  path: string
  printer: string
  /** 1-based ranges as SumatraPDF takes them ("1-3,5"); omit for all pages. */
  pages?: string
  copies: number
  orientation?: 'portrait' | 'landscape'
  /** Fit the page to the paper, print at actual size, or shrink only if too big. */
  scale: 'fit' | 'noscale' | 'shrink'
  monochrome: boolean
  side?: 'simplex' | 'duplexlong' | 'duplexshort'
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
    /** Versions for the About dialog. */
    getInfo(): Promise<AppInfo>
    /**
     * Opens the third-party licence notices in the default text editor.
     * Resolves false if the file is missing.
     */
    openNotices(): Promise<boolean>
    /**
     * Opens a link from a PDF in the default browser or mail program. Only
     * the addresses `externalLinkTarget` (shared/links.ts) accepts; resolves
     * false for anything else. Ask the user first: this does not.
     */
    openLink(url: string): Promise<boolean>
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
    showSaveDialog(defaultPath: string, title?: string, kind?: SaveKind): Promise<string | null>
    /** Shows an Open dialog for one PDF, several PDFs or one picture (PNG/JPEG). */
    choose(kind: FileChoice, title?: string): Promise<string[]>
    /** Shows a folder picker. Null if cancelled. */
    chooseFolder(defaultPath?: string, title?: string): Promise<string | null>
    /** Opens Explorer with the file selected. */
    showInFolder(path: string): void
    /** Opens a file PDFnix wrote (Word, text, picture) in its usual program. */
    openExternally(path: string): Promise<void>
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
  print: {
    printers(): Promise<PrinterInfo[]>
    /** Prints the file and then deletes it. Rejects with a readable message. */
    print(request: PrintRequest): Promise<void>
  }
  /** The signature and initials library, stored by main in the app-data folder. */
  signatures: {
    list(): Promise<SignatureEntry[]>
    add(signature: NewSignature): Promise<SignatureEntry>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
    setDefault(id: string): Promise<void>
  }
}

/** IPC channel names, kept in one place so main and preload cannot drift apart. */
export const IPC = {
  engineGetConnection: 'engine:getConnection',
  engineGetStatus: 'engine:getStatus',
  engineStatus: 'engine:status',
  appGetVersion: 'app:getVersion',
  appGetInfo: 'app:getInfo',
  appOpenNotices: 'app:openNotices',
  appOpenLink: 'app:openLink',
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
  filesChoose: 'files:choose',
  filesChooseFolder: 'files:chooseFolder',
  filesShowInFolder: 'files:showInFolder',
  filesOpenExternally: 'files:openExternally',
  filesTakePending: 'files:takePending',
  filesOpenRequest: 'files:openRequest',
  filesGetRecent: 'files:getRecent',
  filesAddRecent: 'files:addRecent',
  filesRemoveRecent: 'files:removeRecent',
  filesClearRecent: 'files:clearRecent',
  filesRecentChanged: 'files:recentChanged',
  menuCommand: 'menu:command',
  menuSetState: 'menu:setState',
  signaturesList: 'signatures:list',
  signaturesAdd: 'signatures:add',
  signaturesRename: 'signatures:rename',
  signaturesRemove: 'signatures:remove',
  signaturesSetDefault: 'signatures:setDefault',
  printPrinters: 'print:printers',
  printPrint: 'print:print'
} as const
