/**
 * The keyboard reference shown by Help > Keyboard Shortcuts. Each entry names
 * the keys as the user presses them; `shortcutReference.test.ts` checks every
 * entry against `shortcutFor`, so the reference cannot drift from what the
 * keys really do.
 */

import type { CommandId } from './commands'

export interface ShortcutEntry {
  /** Alternatives, each like "Ctrl+Shift+S". */
  keys: string[]
  action: string
  /** What `shortcutFor` must return for each of the keys (checked by the test). */
  command?: CommandId
  /** Scrolling keys: checked to scroll rather than run a command. */
  scrolls?: true
  /** Handled elsewhere (the page organiser, the mouse); not checked. */
  elsewhere?: true
}

export interface ShortcutGroup {
  title: string
  entries: ShortcutEntry[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Files and tabs',
    entries: [
      { keys: ['Ctrl+O'], action: 'Open', command: 'file.open' },
      { keys: ['Ctrl+S'], action: 'Save', command: 'file.save' },
      { keys: ['Ctrl+Shift+S'], action: 'Save As', command: 'file.saveAs' },
      { keys: ['Ctrl+P'], action: 'Print', command: 'file.print' },
      { keys: ['Ctrl+W', 'Ctrl+F4'], action: 'Close tab', command: 'file.closeTab' },
      { keys: ['Ctrl+D'], action: 'Document properties', command: 'file.properties' },
      { keys: ['Ctrl+Tab', 'Ctrl+PageDown'], action: 'Next tab', command: 'tabs.next' },
      {
        keys: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
        action: 'Previous tab',
        command: 'tabs.previous'
      },
      { keys: ['Ctrl+,'], action: 'Settings', command: 'file.preferences' }
    ]
  },
  {
    title: 'Edit and find',
    entries: [
      { keys: ['Ctrl+Z'], action: 'Undo', command: 'edit.undo' },
      { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], action: 'Redo', command: 'edit.redo' },
      { keys: ['Delete'], action: 'Delete the selected annotation', command: 'edit.delete' },
      {
        keys: ['Escape'],
        action: 'Cancel, deselect, back to Select',
        command: 'edit.escape'
      },
      { keys: ['Ctrl+F'], action: 'Find', command: 'edit.find' },
      { keys: ['F3', 'Ctrl+G'], action: 'Next result', command: 'edit.findNext' },
      {
        keys: ['Shift+F3', 'Ctrl+Shift+G'],
        action: 'Previous result',
        command: 'edit.findPrevious'
      }
    ]
  },
  {
    title: 'View',
    entries: [
      { keys: ['Ctrl++', 'Ctrl+='], action: 'Zoom in', command: 'view.zoomIn' },
      { keys: ['Ctrl+-'], action: 'Zoom out', command: 'view.zoomOut' },
      { keys: ['Ctrl+Wheel'], action: 'Zoom at the pointer', elsewhere: true },
      { keys: ['Ctrl+0'], action: 'Actual size', command: 'view.actualSize' },
      { keys: ['Ctrl+1'], action: 'Fit width', command: 'view.fitWidth' },
      { keys: ['Ctrl+2'], action: 'Fit page', command: 'view.fitPage' },
      { keys: ['Ctrl+R'], action: 'Rotate page right', command: 'view.rotateCw' },
      { keys: ['Ctrl+Shift+R'], action: 'Rotate page left', command: 'view.rotateCcw' },
      { keys: ['F4'], action: 'Show or hide the side panel', command: 'view.toggleSidePanel' }
    ]
  },
  {
    title: 'Move through the document',
    entries: [
      { keys: ['Right'], action: 'Next page', command: 'go.nextPage' },
      { keys: ['Left'], action: 'Previous page', command: 'go.previousPage' },
      { keys: ['Down', 'Up'], action: 'Scroll a little', scrolls: true },
      { keys: ['PageDown', 'Space'], action: 'Scroll down a screen', scrolls: true },
      { keys: ['PageUp', 'Shift+Space'], action: 'Scroll up a screen', scrolls: true },
      { keys: ['Home', 'Ctrl+Home'], action: 'First page', command: 'go.firstPage' },
      { keys: ['End', 'Ctrl+End'], action: 'Last page', command: 'go.lastPage' }
    ]
  },
  {
    title: 'Tools',
    entries: [
      { keys: ['V'], action: 'Select', command: 'tools.select' },
      { keys: ['H'], action: 'Highlight', command: 'tools.highlight' },
      { keys: ['U'], action: 'Underline', command: 'tools.underline' },
      { keys: ['K'], action: 'Strikeout', command: 'tools.strikeout' },
      { keys: ['N'], action: 'Note', command: 'tools.note' },
      { keys: ['T'], action: 'Add text', command: 'tools.text' },
      { keys: ['E'], action: 'Edit text', command: 'tools.editText' },
      { keys: ['I'], action: 'Add image', command: 'tools.image' },
      { keys: ['S'], action: 'Shapes', command: 'tools.shape' },
      { keys: ['D'], action: 'Draw', command: 'tools.draw' },
      { keys: ['X'], action: 'Delete object', command: 'tools.deleteObject' },
      { keys: ['R'], action: 'Redact', command: 'tools.redact' }
    ]
  },
  {
    title: 'Pages and documents',
    entries: [
      { keys: ['Ctrl+Shift+O'], action: 'Organise pages', command: 'document.organise' },
      { keys: ['Ctrl+Shift+X'], action: 'Redact…', command: 'document.redact' },
      { keys: ['Ctrl+Arrows'], action: 'Move the selected pages (organiser)', elsewhere: true },
      { keys: ['Delete'], action: 'Delete the selected pages (organiser)', elsewhere: true },
      { keys: ['Ctrl+A'], action: 'Select all pages (organiser)', elsewhere: true }
    ]
  },
  {
    title: 'Help',
    entries: [{ keys: ['Ctrl+/', 'F1'], action: 'Keyboard shortcuts', command: 'help.shortcuts' }]
  }
]
