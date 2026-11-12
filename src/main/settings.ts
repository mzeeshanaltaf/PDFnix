import Store from 'electron-store'
import { isThemeSource, type ThemeSource } from '../shared/api'

interface SettingsSchema {
  theme: ThemeSource
}

const DEFAULTS: SettingsSchema = { theme: 'system' }

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
