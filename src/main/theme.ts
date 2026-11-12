import { BrowserWindow, nativeTheme } from 'electron'
import { IPC, type ThemeSource } from '../shared/api'
import { getTheme, setTheme } from './settings'

/**
 * Window background while the page is still loading. These match the
 * `--background` values in src/renderer/src/assets/main.css so there is no
 * flash of the wrong colour on start.
 */
const BACKGROUND = { light: '#fafafb', dark: '#1a1b1e' } as const

type ThemeListener = (theme: ThemeSource) => void
const listeners = new Set<ThemeListener>()

/**
 * Applies the saved theme. `nativeTheme.themeSource` drives the renderer's
 * `prefers-color-scheme`, which is what the stylesheet keys on, so the right
 * colours are in place before any script runs.
 */
export function applySavedTheme(): ThemeSource {
  const theme = getTheme()
  nativeTheme.themeSource = theme
  return theme
}

export function currentTheme(): ThemeSource {
  return getTheme()
}

export function changeTheme(theme: ThemeSource): ThemeSource {
  setTheme(theme)
  nativeTheme.themeSource = theme
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(windowBackground())
    window.webContents.send(IPC.themeChanged, theme)
  }
  for (const listener of listeners) listener(theme)
  return theme
}

export function onThemeChanged(listener: ThemeListener): void {
  listeners.add(listener)
}

export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light
}
