import { create } from 'zustand'
import { RECOVERY_MINUTES, type ThemeSource, type UserSettings } from '../../../shared/api'
import { engine } from '@/api/engine'
import { setDefaultView } from './tabs'
import { DEFAULT_COLORS, useTools } from './tools'

interface SettingsState extends UserSettings {
  theme: ThemeSource
  setTheme: (theme: ThemeSource) => Promise<void>
  update: (patch: Partial<UserSettings>) => Promise<void>
}

/** What the app uses until main has answered (the same as main's defaults). */
const DEFAULT_SETTINGS: UserSettings = {
  authorName: '',
  highlightColor: DEFAULT_COLORS.highlight,
  defaultZoom: 'actual-size',
  defaultLayout: 'continuous',
  ocrLanguages: ['eng'],
  recoveryMinutes: RECOVERY_MINUTES.default,
  scanCodes: true
}

function applyUserSettings(settings: UserSettings): void {
  const previous = useSettings.getState().highlightColor
  useSettings.setState({
    authorName: settings.authorName,
    highlightColor: settings.highlightColor,
    defaultZoom: settings.defaultZoom,
    defaultLayout: settings.defaultLayout,
    ocrLanguages: settings.ocrLanguages,
    recoveryMinutes: settings.recoveryMinutes,
    scanCodes: settings.scanCodes
  })
  setDefaultView(settings.defaultZoom, settings.defaultLayout)
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
export const useSettings = create<SettingsState>((set, get) => ({
  theme: 'system',
  ...DEFAULT_SETTINGS,
  highlightColor: '',
  setTheme: async (theme) => {
    set({ theme })
    set({ theme: await window.api.theme.set(theme) })
  },
  update: async (patch) => {
    const before = get().recoveryMinutes
    const saved = await window.api.settings.set(patch)
    applyUserSettings(saved)
    // The running engine takes the new interval at once; a restarted one gets
    // it from main when it starts.
    if (saved.recoveryMinutes !== before) {
      await engine.setRecoveryDelay(saved.recoveryMinutes * 60).catch(() => {})
    }
  }
}))

/** Loads the saved settings and keeps them in sync with changes made from the menu. */
export function startSettingsSync(): () => void {
  void window.api.theme.get().then((theme) => useSettings.setState({ theme }))
  void window.api.settings
    .get()
    .then(applyUserSettings)
    .catch(() => applyUserSettings(DEFAULT_SETTINGS))
  return window.api.theme.onChange((theme) => useSettings.setState({ theme }))
}
