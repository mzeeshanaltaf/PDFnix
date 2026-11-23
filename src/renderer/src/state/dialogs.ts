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
  /** The tab whose pages the full-window organiser shows, or `null`. */
  organiseTabId: string | null
  splitTabId: string | null
  mergeOpen: boolean
  redactTabId: string | null
  watermarkTabId: string | null
  headerFooterTabId: string | null
  compressTabId: string | null
  protectTabId: string | null
  ocrTabId: string | null
  printTabId: string | null
  ocrLanguagesOpen: boolean
  /** PDF to Word, images or text for a tab. */
  convert: { tabId: string; kind: ConvertKind } | null
  imagesToPdfOpen: boolean
  aboutOpen: boolean
  shortcutsOpen: boolean
  /** The tab whose QR codes and barcodes the results dialog lists, or `null`. */
  codesTabId: string | null
}

export type ConvertKind = 'word' | 'images' | 'text'

export const useDialogs = create<DialogsState>(() => ({
  password: null,
  propertiesTabId: null,
  preferencesOpen: false,
  recovery: [],
  organiseTabId: null,
  splitTabId: null,
  mergeOpen: false,
  redactTabId: null,
  watermarkTabId: null,
  headerFooterTabId: null,
  compressTabId: null,
  protectTabId: null,
  ocrTabId: null,
  printTabId: null,
  ocrLanguagesOpen: false,
  convert: null,
  imagesToPdfOpen: false,
  aboutOpen: false,
  shortcutsOpen: false,
  codesTabId: null
}))

export function showCodes(tabId: string | null): void {
  useDialogs.setState({ codesTabId: tabId })
}

export type ToolDialog =
  | 'organiseTabId'
  | 'splitTabId'
  | 'redactTabId'
  | 'watermarkTabId'
  | 'headerFooterTabId'
  | 'compressTabId'
  | 'protectTabId'
  | 'ocrTabId'
  | 'printTabId'

/** Opens (with a tab id) or closes (null) one of the document tool dialogs. */
export function showToolDialog(dialog: ToolDialog, tabId: string | null): void {
  useDialogs.setState({ [dialog]: tabId } as Partial<DialogsState>)
}

export function showMerge(open: boolean): void {
  useDialogs.setState({ mergeOpen: open })
}

export function showConvert(tabId: string | null, kind: ConvertKind = 'word'): void {
  useDialogs.setState({ convert: tabId ? { tabId, kind } : null })
}

export function showOcrLanguages(open: boolean): void {
  useDialogs.setState({ ocrLanguagesOpen: open })
}

export function showImagesToPdf(open: boolean): void {
  useDialogs.setState({ imagesToPdfOpen: open })
}

export interface Confirmation {
  title: string
  message: string
  /** Extra lines under the message (file names, say). */
  details?: string[]
  confirmLabel: string
  /** The action cannot be taken back (red button). */
  destructive?: boolean
}

interface ConfirmState {
  current: Confirmation | null
}

export const useConfirm = create<ConfirmState>(() => ({ current: null }))

let confirmAnswer: ((yes: boolean) => void) | null = null

/** Asks a yes/no question in the app's own dialog. */
export function confirmAction(question: Confirmation): Promise<boolean> {
  confirmAnswer?.(false)
  useConfirm.setState({ current: question })
  return new Promise((resolve) => {
    confirmAnswer = resolve
  })
}

export interface RangeQuestion {
  title: string
  description: string
  /** Pre-filled text, e.g. "3". */
  initial: string
  pageCount: number
  confirmLabel: string
}

interface RangeState {
  current: RangeQuestion | null
}

export const useRangePrompt = create<RangeState>(() => ({ current: null }))

let rangeAnswer: ((pages: number[] | null) => void) | null = null

/** Asks for a page range; resolves with 0-based pages, or null if cancelled. */
export function askPageRange(question: RangeQuestion): Promise<number[] | null> {
  rangeAnswer?.(null)
  useRangePrompt.setState({ current: question })
  return new Promise((resolve) => {
    rangeAnswer = resolve
  })
}

export function answerPageRange(pages: number[] | null): void {
  const resolve = rangeAnswer
  rangeAnswer = null
  useRangePrompt.setState({ current: null })
  resolve?.(pages)
}

export function answerConfirmation(yes: boolean): void {
  const resolve = confirmAnswer
  confirmAnswer = null
  useConfirm.setState({ current: null })
  resolve?.(yes)
}

export function showPreferences(open: boolean): void {
  useDialogs.setState({ preferencesOpen: open })
}

export function showAbout(open: boolean): void {
  useDialogs.setState({ aboutOpen: open })
}

export function showShortcuts(open: boolean): void {
  useDialogs.setState({ shortcutsOpen: open })
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
