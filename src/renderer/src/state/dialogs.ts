import { create } from 'zustand'
import type { RecoveryEntry } from '../api/engine'

export interface PasswordPrompt {
  fileName: string
  /** True after a password was tried and rejected. */
  wrong: boolean
  /** True while the password that was entered is being checked. */
  checking: boolean
  /** Counts the times the user has been asked, so each time starts empty. */
  attempt: number
}

interface DialogsState {
  password: PasswordPrompt | null
  /** The tab whose properties are shown, or `null`. */
  propertiesTabId: string | null
  preferencesOpen: boolean
  /** Recovery copies on offer; the dialog shows while this is not empty. */
  recovery: RecoveryEntry[]
}

export const useDialogs = create<DialogsState>(() => ({
  password: null,
  propertiesTabId: null,
  preferencesOpen: false,
  recovery: []
}))

export function showPreferences(open: boolean): void {
  useDialogs.setState({ preferencesOpen: open })
}

let answer: ((password: string | null) => void) | null = null

/**
 * Shows the password dialog (or, if it is already open, puts it back into
 * its asking state) and resolves with what the user entered, or `null` if
 * they cancelled. The dialog stays open, marked as checking, until
 * `closePasswordPrompt` or the next `askPassword`.
 */
export function askPassword(fileName: string, wrong: boolean): Promise<string | null> {
  answer?.(null)
  const attempt = (useDialogs.getState().password?.attempt ?? 0) + 1
  useDialogs.setState({ password: { fileName, wrong, checking: false, attempt } })
  return new Promise((resolve) => {
    answer = resolve
  })
}

export function submitPassword(password: string): void {
  const resolve = answer
  answer = null
  const current = useDialogs.getState().password
  if (current) useDialogs.setState({ password: { ...current, checking: true } })
  resolve?.(password)
}

export function cancelPassword(): void {
  const resolve = answer
  answer = null
  useDialogs.setState({ password: null })
  resolve?.(null)
}

export function closePasswordPrompt(): void {
  answer = null
  useDialogs.setState({ password: null })
}

export function showProperties(tabId: string | null): void {
  useDialogs.setState({ propertiesTabId: tabId })
}
