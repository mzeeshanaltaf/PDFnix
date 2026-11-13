import { create } from 'zustand'
import type { ThemeSource, UserSettings } from '../../../shared/api'
import { DEFAULT_COLORS, useTools } from './tools'

interface SettingsState extends UserSettings {
  theme: ThemeSource
  setTheme: (theme: ThemeSource) => Promise<void>
  update: (patch: Partial<UserSettings>) => Promise<void>
}

function applyUserSettings(settings: UserSettings): void {
  const previous = useSettings.getState().highlightColor
  useSettings.setState({
    authorName: settings.authorName,
    highlightColor: settings.highlightColor
  })
  // The highlight tool starts with the default colour; a colour picked on
  // the toolbar since then is kept unless the default itself changes.
  const tools = useTools.getState()
  if (tools.colors.highlight === previous || previous === '') {
    tools.setColor('highlight', settings.highlightColor)
  }
}

/**
 * User settings. They are persisted by the main process (electron-store);
 * this store mirrors them for the UI. The colours themselves follow
 * `prefers-color-scheme`, so nothing here has to run before the first paint.
 */
export const useSettings = create<SettingsState>((set) => ({
  theme: 'system',
  authorName: '',
  highlightColor: '',
  setTheme: async (theme) => {
    set({ theme })
    set({ theme: await window.api.theme.set(theme) })
  },
  update: async (patch) => {
    applyUserSettings(await window.api.settings.set(patch))
  }
}))

/** Loads the saved settings and keeps them in sync with changes made from the menu. */
export function startSettingsSync(): () => void {
  void window.api.theme.get().then((theme) => useSettings.setState({ theme }))
  void window.api.settings
    .get()
    .then(applyUserSettings)
    .catch(() => applyUserSettings({ authorName: '', highlightColor: DEFAULT_COLORS.highlight }))
  return window.api.theme.onChange((theme) => useSettings.setState({ theme }))
}
