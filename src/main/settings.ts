import Store from 'electron-store'
import { userInfo } from 'os'
import { isHexColor, isThemeSource, type ThemeSource, type UserSettings } from '../shared/api'

interface SettingsSchema {
  theme: ThemeSource
  /** Absolute paths, most recent first. */
  recentFiles: string[]
  /** Empty until the user sets one; the Windows user name is used meanwhile. */
  authorName: string
  highlightColor: string
}

export const DEFAULT_HIGHLIGHT_COLOR = '#ffd54f'
const MAX_AUTHOR_LENGTH = 100

const DEFAULTS: SettingsSchema = {
  theme: 'system',
  recentFiles: [],
  authorName: '',
  highlightColor: DEFAULT_HIGHLIGHT_COLOR
}

let store: Store<SettingsSchema> | null = null

function getStore(): Store<SettingsSchema> {
  // Created lazily so the user-data path can be adjusted before first use.
  store ??= new Store<SettingsSchema>({
    name: 'settings',
    defaults: DEFAULTS,
    clearInvalidConfig: true
  })
  return store
}

export function getTheme(): ThemeSource {
  const value: unknown = getStore().get('theme')
  return isThemeSource(value) ? value : DEFAULTS.theme
}

export function setTheme(theme: ThemeSource): void {
  getStore().set('theme', theme)
}

export function getRecentFiles(): string[] {
  const value: unknown = getStore().get('recentFiles')
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

export function setRecentFiles(paths: string[]): void {
  getStore().set('recentFiles', paths)
}

function systemUserName(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

export function getUserSettings(): UserSettings {
  const author: unknown = getStore().get('authorName')
  const color: unknown = getStore().get('highlightColor')
  return {
    authorName: (typeof author === 'string' && author.trim()) || systemUserName(),
    highlightColor: isHexColor(color) ? color.toLowerCase() : DEFAULT_HIGHLIGHT_COLOR
  }
}

/** Applies the valid parts of `patch` and returns the settings as they now are. */
export function setUserSettings(patch: unknown): UserSettings {
  const candidate = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<
    string,
    unknown
  >
  if (typeof candidate.authorName === 'string') {
    getStore().set('authorName', candidate.authorName.trim().slice(0, MAX_AUTHOR_LENGTH))
  }
  if (isHexColor(candidate.highlightColor)) {
    getStore().set('highlightColor', candidate.highlightColor.toLowerCase())
  }
  return getUserSettings()
}
