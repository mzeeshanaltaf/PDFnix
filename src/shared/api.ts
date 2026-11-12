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
  }
  theme: {
    get(): Promise<ThemeSource>
    set(theme: ThemeSource): Promise<ThemeSource>
    onChange(listener: (theme: ThemeSource) => void): Unsubscribe
  }
}

/** IPC channel names, kept in one place so main and preload cannot drift apart. */
export const IPC = {
  engineGetConnection: 'engine:getConnection',
  engineGetStatus: 'engine:getStatus',
  engineStatus: 'engine:status',
  appGetVersion: 'app:getVersion',
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  themeChanged: 'theme:changed'
} as const
