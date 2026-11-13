import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import {
  EMPTY_MENU_STATE,
  IPC,
  type LayoutMode,
  type MenuCommand,
  type MenuState,
  type ThemeSource
} from '../shared/api'
import { clearRecent, listRecent, openFiles, openWithDialog } from './files'
import { changeTheme, currentTheme } from './theme'

let getWindow: () => BrowserWindow | null = () => null
let state: MenuState = EMPTY_MENU_STATE

/** A menu entry that exists but is not implemented yet. */
function placeholder(label: string, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, enabled: false, registerAccelerator: false }
}

/**
 * An entry that runs a command in the renderer.
 *
 * The shortcut is shown but not registered: the renderer handles the keyboard
 * itself (src/renderer/src/shell/shortcuts.ts), so a key press never runs a
 * command twice.
 */
function command(
  label: string,
  id: MenuCommand,
  accelerator?: string,
  options: { needsDocument?: boolean; enabled?: boolean } = {}
): MenuItemConstructorOptions {
  const { needsDocument = true, enabled = true } = options
  return {
    label,
    accelerator,
    registerAccelerator: false,
    enabled: enabled && (!needsDocument || state.hasDocument),
    click: () => {
      const window = getWindow()
      if (window && !window.isDestroyed()) window.webContents.send(IPC.menuCommand, id)
    }
  }
}

function layoutItem(label: string, layout: LayoutMode): MenuItemConstructorOptions {
  return {
    ...command(label, `view.layout.${layout}`),
    type: 'radio',
    checked: state.layout === layout
  }
}

function themeItem(label: string, theme: ThemeSource): MenuItemConstructorOptions {
  return {
    label,
    type: 'radio',
    checked: currentTheme() === theme,
    click: () => {
      changeTheme(theme)
    }
  }
}

function recentItems(): MenuItemConstructorOptions[] {
  const recent = listRecent()
  if (recent.length === 0) return [{ label: 'No Recent Files', enabled: false }]
  return [
    ...recent.map((file, index): MenuItemConstructorOptions => ({
      // An ampersand would otherwise be read as a keyboard mnemonic.
      label: `${index < 9 ? `&${index + 1}  ` : ''}${file.path.replace(/&/g, '&&')}`,
      click: () => openFiles([file.path])
    })),
    { type: 'separator' },
    { label: 'Clear Recent Files', click: () => clearRecent() }
  ]
}

function showAbout(window: BrowserWindow | null): void {
  const options = {
    type: 'info' as const,
    title: `About ${app.getName()}`,
    message: app.getName(),
    detail: [
      `Version ${app.getVersion()}`,
      '',
      `Electron ${process.versions.electron}`,
      `Chromium ${process.versions.chrome}`,
      `Node.js ${process.versions.node}`
    ].join('\n'),
    buttons: ['OK']
  }
  if (window) void dialog.showMessageBox(window, options)
  else void dialog.showMessageBox(options)
}

/**
 * Builds the application menu. Entries for features that later phases
 * implement are present but disabled.
 */
export function buildMenu(): void {
  const view: MenuItemConstructorOptions[] = [
    command('Zoom In', 'view.zoomIn', 'CmdOrCtrl+Plus'),
    command('Zoom Out', 'view.zoomOut', 'CmdOrCtrl+-'),
    command('Actual Size', 'view.actualSize', 'CmdOrCtrl+0'),
    command('Fit Width', 'view.fitWidth', 'CmdOrCtrl+1'),
    command('Fit Page', 'view.fitPage', 'CmdOrCtrl+2'),
    { type: 'separator' },
    {
      label: 'Page Layout',
      enabled: state.hasDocument,
      submenu: [
        layoutItem('Continuous', 'continuous'),
        layoutItem('Single Page', 'single'),
        layoutItem('Two Pages', 'two-page')
      ]
    },
    { type: 'separator' },
    command('Rotate Page Clockwise', 'view.rotateCw', 'CmdOrCtrl+R'),
    command('Rotate Page Counterclockwise', 'view.rotateCcw', 'CmdOrCtrl+Shift+R'),
    command('Rotate All Pages Clockwise', 'view.rotateAllCw'),
    command('Rotate All Pages Counterclockwise', 'view.rotateAllCcw'),
    { type: 'separator' },
    command('Next Page', 'go.nextPage', 'Right'),
    command('Previous Page', 'go.previousPage', 'Left'),
    command('First Page', 'go.firstPage', 'CmdOrCtrl+Home'),
    command('Last Page', 'go.lastPage', 'CmdOrCtrl+End'),
    { type: 'separator' },
    command('Side Panel', 'view.toggleSidePanel', 'F4'),
    { type: 'separator' },
    {
      label: 'Theme',
      submenu: [
        themeItem('Follow System', 'system'),
        themeItem('Light', 'light'),
        themeItem('Dark', 'dark')
      ]
    }
  ]

  if (!app.isPackaged) {
    view.push(
      { type: 'separator' },
      { label: 'Reload', accelerator: 'F5', role: 'reload' },
      { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' }
    )
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          registerAccelerator: false,
          click: () => void openWithDialog()
        },
        { label: 'Open Recent', submenu: recentItems() },
        { type: 'separator' },
        command('Save', 'file.save', 'CmdOrCtrl+S'),
        command('Save As…', 'file.saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        placeholder('Print…', 'CmdOrCtrl+P'),
        { type: 'separator' },
        command('Properties…', 'file.properties', 'CmdOrCtrl+D'),
        command('Preferences…', 'file.preferences', 'CmdOrCtrl+,', { needsDocument: false }),
        { type: 'separator' },
        command('Close Tab', 'file.closeTab', 'CmdOrCtrl+W'),
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        command(state.undoName ? `Undo ${state.undoName}` : 'Undo', 'edit.undo', 'CmdOrCtrl+Z', {
          enabled: state.canUndo
        }),
        command(state.redoName ? `Redo ${state.redoName}` : 'Redo', 'edit.redo', 'CmdOrCtrl+Y', {
          enabled: state.canRedo
        }),
        { type: 'separator' },
        // These act on whatever has the focus: a text box, or text selected
        // on a page.
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
        command('Delete Annotation', 'edit.delete', 'Delete', { enabled: state.canDelete }),
        { label: 'Select All', role: 'selectAll' },
        { type: 'separator' },
        command('Find…', 'edit.find', 'CmdOrCtrl+F'),
        command('Find Next', 'edit.findNext', 'F3'),
        command('Find Previous', 'edit.findPrevious', 'Shift+F3')
      ]
    },
    { label: '&View', submenu: view },
    {
      label: '&Tools',
      submenu: [
        command('Select', 'tools.select', 'V'),
        command('Highlight', 'tools.highlight', 'H'),
        command('Underline', 'tools.underline', 'U'),
        command('Strikeout', 'tools.strikeout', 'K'),
        command('Note', 'tools.note', 'N'),
        { type: 'separator' },
        placeholder('Organise Pages…'),
        placeholder('Fill Form'),
        placeholder('Redact…'),
        placeholder('Watermark…'),
        { type: 'separator' },
        placeholder('Compress…'),
        placeholder('Protect with Password…'),
        placeholder('Recognise Text (OCR)…'),
        placeholder('Convert…')
      ]
    },
    {
      label: '&Help',
      submenu: [{ label: `About ${app.getName()}`, click: () => showAbout(getWindow()) }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function initMenu(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  buildMenu()
}

/** The renderer reports what is open; entries are enabled and checked to match. */
export function setMenuState(next: MenuState): void {
  const changed = (Object.keys(next) as (keyof MenuState)[]).some((key) => next[key] !== state[key])
  if (!changed) return
  state = next
  buildMenu()
}
