import { describe, expect, it, vi } from 'vitest'

// The commands module pulls in the whole app; only the mapping is tested here.
vi.mock('./commands', () => ({ runCommand: vi.fn() }))
vi.mock('@/viewer/controller', () => ({ getViewer: vi.fn() }))

const { shortcutFor } = await import('./shortcuts')
const { SHORTCUT_GROUPS } = await import('./shortcutReference')

const NAMED: Record<string, string> = {
  Right: 'ArrowRight',
  Left: 'ArrowLeft',
  Down: 'ArrowDown',
  Up: 'ArrowUp',
  Space: ' '
}

/** "Ctrl+Shift+S" -> the key event a browser reports for it. */
function parse(combo: string): Parameters<typeof shortcutFor>[0] {
  const match = /^(Ctrl\+)?(Shift\+)?(.+)$/.exec(combo)
  if (!match) throw new Error(combo)
  const [, ctrl, shift, rest] = match
  const name = NAMED[rest] ?? rest
  return {
    // Browsers report Shift+letter as the capital letter.
    key: shift && name.length === 1 ? name.toUpperCase() : name,
    code: '',
    ctrlKey: Boolean(ctrl),
    shiftKey: Boolean(shift),
    altKey: false,
    metaKey: false
  }
}

const viewing = { typing: false, onControl: false }
const entries = SHORTCUT_GROUPS.flatMap((group) => group.entries)

describe('keyboard shortcut reference', () => {
  it.each(entries.filter((entry) => entry.command))('$keys runs $command', (entry) => {
    for (const combo of entry.keys) {
      expect(shortcutFor(parse(combo), viewing), combo).toEqual({
        type: 'command',
        command: entry.command
      })
    }
  })

  it.each(entries.filter((entry) => entry.scrolls))('$keys scroll', (entry) => {
    for (const combo of entry.keys) {
      expect(shortcutFor(parse(combo), viewing)?.type, combo).toMatch(/^(page|line)$/)
    }
  })

  it('lists every command that has a key', () => {
    const listed = new Set(entries.map((entry) => entry.command).filter(Boolean))
    const probes = ['a', 'b', 'c', 'f', 'g', 'j', 'l', 'm', 'o', 'p', 'q', 'w', 'y', 'z']
    for (const letter of probes) {
      const action = shortcutFor(parse(letter), viewing)
      if (action?.type === 'command') expect(listed, letter).toContain(action.command)
    }
  })
})
