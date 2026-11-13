import { describe, expect, it, vi } from 'vitest'

// The commands module pulls in the whole app; only the mapping is tested here.
vi.mock('./commands', () => ({ runCommand: vi.fn() }))
vi.mock('@/viewer/controller', () => ({ getViewer: vi.fn() }))

const { shortcutFor } = await import('./shortcuts')

const key = (
  name: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
  code = ''
): Parameters<typeof shortcutFor>[0] => ({
  key: name,
  code,
  ctrlKey: modifiers.ctrl ?? false,
  shiftKey: modifiers.shift ?? false,
  altKey: modifiers.alt ?? false,
  metaKey: false
})
const viewing = { typing: false, onControl: false }
const typing = { typing: true, onControl: false }
const command = (id: string): unknown => ({ type: 'command', command: id })

describe('shortcutFor', () => {
  it('maps the document shortcuts', () => {
    expect(shortcutFor(key('o', { ctrl: true }), viewing)).toEqual(command('file.open'))
    expect(shortcutFor(key('W', { ctrl: true }), viewing)).toEqual(command('file.closeTab'))
    expect(shortcutFor(key('f', { ctrl: true }), viewing)).toEqual(command('edit.find'))
    expect(shortcutFor(key('F3'), viewing)).toEqual(command('edit.findNext'))
    expect(shortcutFor(key('F3', { shift: true }), viewing)).toEqual(command('edit.findPrevious'))
    expect(shortcutFor(key('r', { ctrl: true }), viewing)).toEqual(command('view.rotateCw'))
    expect(shortcutFor(key('R', { ctrl: true, shift: true }), viewing)).toEqual(
      command('view.rotateCcw')
    )
    expect(shortcutFor(key('F4'), viewing)).toEqual(command('view.toggleSidePanel'))
  })

  it('zooms with Ctrl and +, -, 0 on both keyboards', () => {
    expect(shortcutFor(key('=', { ctrl: true }), viewing)).toEqual(command('view.zoomIn'))
    expect(shortcutFor(key('+', { ctrl: true, shift: true }), viewing)).toEqual(
      command('view.zoomIn')
    )
    expect(shortcutFor(key('-', { ctrl: true }), viewing)).toEqual(command('view.zoomOut'))
    expect(shortcutFor(key('0', { ctrl: true }), viewing)).toEqual(command('view.actualSize'))
    expect(shortcutFor(key('Add', { ctrl: true }, 'NumpadAdd'), viewing)).toEqual(
      command('view.zoomIn')
    )
  })

  it('cycles tabs with Ctrl+Tab and Ctrl+Shift+Tab', () => {
    expect(shortcutFor(key('Tab', { ctrl: true }), viewing)).toEqual(command('tabs.next'))
    expect(shortcutFor(key('Tab', { ctrl: true, shift: true }), viewing)).toEqual(
      command('tabs.previous')
    )
  })

  it('moves through the document while reading', () => {
    expect(shortcutFor(key('ArrowRight'), viewing)).toEqual(command('go.nextPage'))
    expect(shortcutFor(key('Home'), viewing)).toEqual(command('go.firstPage'))
    expect(shortcutFor(key('PageDown'), viewing)).toEqual({ type: 'page', fraction: 0.9 })
    expect(shortcutFor(key(' ', { shift: true }), viewing)).toEqual({
      type: 'page',
      fraction: -0.9
    })
    expect(shortcutFor(key('ArrowDown'), viewing)).toEqual({ type: 'line', pixels: 60 })
  })

  it('leaves typing keys to text boxes', () => {
    for (const name of ['ArrowRight', 'ArrowLeft', 'Home', 'End', ' ', 'PageDown']) {
      expect(shortcutFor(key(name), typing)).toBeNull()
    }
    // Ctrl+Home in a text box is the text box's.
    expect(shortcutFor(key('Home', { ctrl: true }), typing)).toBeNull()
    // Application shortcuts still work.
    expect(shortcutFor(key('f', { ctrl: true }), typing)).toEqual(command('edit.find'))
    expect(shortcutFor(key('F3'), typing)).toEqual(command('edit.findNext'))
  })

  it('leaves Space to a focused button', () => {
    expect(shortcutFor(key(' '), { typing: false, onControl: true })).toBeNull()
  })

  it('ignores Alt combinations and unknown keys', () => {
    expect(shortcutFor(key('f', { alt: true }), viewing)).toBeNull()
    expect(shortcutFor(key('q'), viewing)).toBeNull()
    expect(shortcutFor(key('q', { ctrl: true }), viewing)).toBeNull()
  })
})
