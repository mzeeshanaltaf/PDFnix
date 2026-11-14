/**
 * Keyboard shortcuts. The application menu shows these shortcuts but does not
 * register them (see src/main/menu.ts); the keyboard is handled here, in one
 * place, so no key press can run a command twice.
 */

import { getViewer } from '@/viewer/controller'
import { runCommand, type CommandId } from './commands'

export interface KeyInfo {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export interface KeyContext {
  /** The focus is in a text box. */
  typing: boolean
  /** The focus is on a button or similar, which Space and Enter activate. */
  onControl: boolean
}

export type ShortcutAction =
  | { type: 'command'; command: CommandId }
  /** Scroll by a share of the viewport height. */
  | { type: 'page'; fraction: number }
  /** Scroll by pixels. */
  | { type: 'line'; pixels: number }

const LINE_PX = 60
const PAGE_FRACTION = 0.9

function command(id: CommandId): ShortcutAction {
  return { type: 'command', command: id }
}

/** What a key press means, or `null` if it is not a shortcut here. */
export function shortcutFor(key: KeyInfo, context: KeyContext): ShortcutAction | null {
  if (key.altKey || key.metaKey) return null
  const name = key.key.length === 1 ? key.key.toLowerCase() : key.key

  if (key.ctrlKey) {
    switch (name) {
      case 'o':
        return command(key.shiftKey ? 'document.organise' : 'file.open')
      case 'x':
        return key.shiftKey && !context.typing ? command('document.redact') : null
      case 's':
        return command(key.shiftKey ? 'file.saveAs' : 'file.save')
      case ',':
        return key.shiftKey ? null : command('file.preferences')
      // In a text box, undo and redo are the text box's own.
      case 'z':
        return context.typing ? null : command(key.shiftKey ? 'edit.redo' : 'edit.undo')
      case 'y':
        return context.typing || key.shiftKey ? null : command('edit.redo')
      case 'p':
        return key.shiftKey ? null : command('file.print')
      case 'w':
      case 'F4':
        return key.shiftKey ? null : command('file.closeTab')
      case 'd':
        return key.shiftKey ? null : command('file.properties')
      case 'f':
        return key.shiftKey ? null : command('edit.find')
      case 'g':
        return command(key.shiftKey ? 'edit.findPrevious' : 'edit.findNext')
      case 'r':
        return command(key.shiftKey ? 'view.rotateCcw' : 'view.rotateCw')
      case '+':
      case '=':
        return command('view.zoomIn')
      case '-':
      case '_':
        return command('view.zoomOut')
      case '0':
        return command('view.actualSize')
      case '1':
        return command('view.fitWidth')
      case '2':
        return command('view.fitPage')
      case 'Tab':
        return command(key.shiftKey ? 'tabs.previous' : 'tabs.next')
      case 'PageDown':
        return command('tabs.next')
      case 'PageUp':
        return command('tabs.previous')
      case 'Home':
        return context.typing ? null : command('go.firstPage')
      case 'End':
        return context.typing ? null : command('go.lastPage')
    }
    // The numeric keypad reports the same characters, except with Num Lock off.
    if (key.code === 'NumpadAdd') return command('view.zoomIn')
    if (key.code === 'NumpadSubtract') return command('view.zoomOut')
    return null
  }

  switch (name) {
    case 'F3':
      return command(key.shiftKey ? 'edit.findPrevious' : 'edit.findNext')
    case 'F4':
      return key.shiftKey ? null : command('view.toggleSidePanel')
  }

  // The rest moves through the document or picks tools, and must not steal
  // keys from a text box or from a focused button.
  if (context.typing) return null
  switch (name) {
    case 'Escape':
      return command('edit.escape')
    case 'Delete':
    case 'Backspace':
      return key.shiftKey ? null : command('edit.delete')
    case 'v':
      return key.shiftKey ? null : command('tools.select')
    case 'h':
      return key.shiftKey ? null : command('tools.highlight')
    case 'u':
      return key.shiftKey ? null : command('tools.underline')
    case 'k':
      return key.shiftKey ? null : command('tools.strikeout')
    case 'n':
      return key.shiftKey ? null : command('tools.note')
    case 't':
      return key.shiftKey ? null : command('tools.text')
    case 'e':
      return key.shiftKey ? null : command('tools.editText')
    case 'i':
      return key.shiftKey ? null : command('tools.image')
    case 's':
      return key.shiftKey ? null : command('tools.shape')
    case 'd':
      return key.shiftKey ? null : command('tools.draw')
    case 'x':
      return key.shiftKey ? null : command('tools.deleteObject')
    case 'r':
      return key.shiftKey ? null : command('tools.redact')
    case 'ArrowRight':
      return key.shiftKey ? null : command('go.nextPage')
    case 'ArrowLeft':
      return key.shiftKey ? null : command('go.previousPage')
    case 'ArrowDown':
      return key.shiftKey ? null : { type: 'line', pixels: LINE_PX }
    case 'ArrowUp':
      return key.shiftKey ? null : { type: 'line', pixels: -LINE_PX }
    case 'PageDown':
      return { type: 'page', fraction: PAGE_FRACTION }
    case 'PageUp':
      return { type: 'page', fraction: -PAGE_FRACTION }
    case 'Home':
      return command('go.firstPage')
    case 'End':
      return command('go.lastPage')
    case ' ':
      if (context.onControl) return null
      return { type: 'page', fraction: key.shiftKey ? -PAGE_FRACTION : PAGE_FRACTION }
  }
  return null
}

function contextOf(target: EventTarget | null): KeyContext | null {
  if (!(target instanceof Element)) return { typing: false, onControl: false }
  // Dialogs and open menus handle their own keys.
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return null
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  const onControl = target.closest('button, a[href], [role="button"], [role="tab"]') !== null
  return { typing, onControl }
}

/** Starts handling the keyboard. Returns a function that stops it. */
export function installShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return
    const context = contextOf(event.target)
    if (!context) return
    const action = shortcutFor(event, context)
    if (!action) return

    if (action.type === 'command') {
      event.preventDefault()
      runCommand(action.command)
      return
    }
    const viewer = getViewer()
    if (!viewer) return
    event.preventDefault()
    if (action.type === 'page') viewer.scrollByViewport(action.fraction)
    else viewer.scrollByPixels(0, action.pixels)
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
