import { create } from 'zustand'
import type { ThemeSource } from '../../../shared/api'

interface SettingsState {
  theme: ThemeSource
  setTheme: (theme: ThemeSource) => Promise<void>
}

/**
 * User settings. They are persisted by the main process (electron-store);
 * this store mirrors them for the UI. The colours themselves follow
 * `prefers-color-scheme`, so nothing here has to run before the first paint.
 */
export const useSettings = create<SettingsState>((set) => ({
  theme: 'system',
  setTheme: async (theme) => {
    set({ theme })
    set({ theme: await window.api.theme.set(theme) })
  }
}))

/** Loads the saved settings and keeps them in sync with changes made from the menu. */
export function startSettingsSync(): () => void {
  void window.api.theme.get().then((theme) => useSettings.setState({ theme }))
  return window.api.theme.onChange((theme) => useSettings.setState({ theme }))
}
