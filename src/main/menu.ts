import { app, dialog, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { ThemeSource } from '../shared/api'
import { changeTheme, currentTheme } from './theme'

/** A menu entry that exists but is not implemented yet. */
function placeholder(label: string, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, enabled: false }
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
export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const view: MenuItemConstructorOptions[] = [
    placeholder('Zoom In', 'CmdOrCtrl+Plus'),
    placeholder('Zoom Out', 'CmdOrCtrl+-'),
    placeholder('Actual Size', 'CmdOrCtrl+0'),
    placeholder('Fit Width'),
    placeholder('Fit Page'),
    { type: 'separator' },
    placeholder('Rotate Clockwise', 'CmdOrCtrl+R'),
    placeholder('Rotate Counterclockwise', 'CmdOrCtrl+Shift+R'),
    { type: 'separator' },
    placeholder('Side Panel', 'F4'),
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
        placeholder('Open…', 'CmdOrCtrl+O'),
        placeholder('Open Recent'),
        { type: 'separator' },
        placeholder('Save', 'CmdOrCtrl+S'),
        placeholder('Save As…', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        placeholder('Print…', 'CmdOrCtrl+P'),
        { type: 'separator' },
        placeholder('Close Tab', 'CmdOrCtrl+W'),
        { label: 'Exit', role: 'quit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        placeholder('Undo', 'CmdOrCtrl+Z'),
        placeholder('Redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        placeholder('Cut', 'CmdOrCtrl+X'),
        placeholder('Copy', 'CmdOrCtrl+C'),
        placeholder('Paste', 'CmdOrCtrl+V'),
        placeholder('Delete', 'Delete'),
        placeholder('Select All', 'CmdOrCtrl+A'),
        { type: 'separator' },
        placeholder('Find…', 'CmdOrCtrl+F')
      ]
    },
    { label: '&View', submenu: view },
    {
      label: '&Tools',
      submenu: [
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
