import { Sparkles } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  menuPlacement,
  registerSelectionMenuSection,
  selectionMenuSections,
  subscribeSelectionMenuSections,
  type Box,
  type SelectionMenuSection
} from './selectionMenuState'

const viewport = { width: 1200, height: 800 }
const size = { width: 300, height: 120 }

function line(left: number, top: number, right: number, height = 16): Box {
  return { left, top, right, bottom: top + height }
}

describe('menuPlacement', () => {
  it('goes below the last line, centred on where the selection ends', () => {
    const rects = [line(100, 200, 700), line(100, 220, 400)]
    expect(menuPlacement({ rects }, size, viewport)).toEqual({ left: 250, top: 244 })
  })

  it('flips above the first line when it would reach the status bar', () => {
    const rects = [line(100, 600, 700), line(100, 660, 400)]
    // Below would end at 684 + 120 = 804 > 800 - 40.
    expect(menuPlacement({ rects }, size, viewport)).toEqual({ left: 250, top: 600 - 120 - 8 })
  })

  it('stays inside the window on the left and on the right', () => {
    expect(menuPlacement({ rects: [line(0, 100, 40)] }, size, viewport)?.left).toBe(8)
    expect(menuPlacement({ rects: [line(900, 100, 1195)] }, size, viewport)?.left).toBe(
      1200 - 300 - 8
    )
  })

  it('does not go above the window when neither side has room', () => {
    const rects = [line(100, 20, 700, 760)]
    expect(menuPlacement({ rects }, size, viewport)?.top).toBe(8)
  })

  it('puts a right-click menu at the pointer, clamped to the window', () => {
    expect(menuPlacement({ point: { x: 400, y: 300 } }, size, viewport)).toEqual({
      left: 400,
      top: 300
    })
    expect(menuPlacement({ point: { x: 1150, y: 790 } }, size, viewport)).toEqual({
      left: 1200 - 300 - 8,
      top: 800 - 120 - 40
    })
  })

  it('has nowhere to go without rects', () => {
    expect(menuPlacement({ rects: [] }, size, viewport)).toBeNull()
  })
})

describe('selection menu sections', () => {
  const undo: (() => void)[] = []
  afterEach(() => {
    for (const remove of undo.splice(0)) remove()
  })
  const section = (id: string, items = 1): SelectionMenuSection => ({
    id,
    items: Array.from({ length: items }, (_, index) => ({
      id: `${id}-${index}`,
      label: `Item ${index}`,
      icon: Sparkles,
      run: vi.fn()
    }))
  })

  it('draws no extra section while none is registered', () => {
    expect(selectionMenuSections()).toEqual([])
  })

  it('leaves out sections without items', () => {
    undo.push(registerSelectionMenuSection(section('empty', 0)))
    expect(selectionMenuSections()).toEqual([])
  })

  it('lists sections in the order they were added, and removes them again', () => {
    const listener = vi.fn()
    undo.push(subscribeSelectionMenuSections(listener))
    const removeA = registerSelectionMenuSection(section('a'))
    undo.push(registerSelectionMenuSection(section('b')))
    expect(selectionMenuSections().map((s) => s.id)).toEqual(['a', 'b'])
    removeA()
    expect(selectionMenuSections().map((s) => s.id)).toEqual(['b'])
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('replaces a section registered again under the same id', () => {
    undo.push(registerSelectionMenuSection(section('ai', 1)))
    undo.push(registerSelectionMenuSection(section('ai', 3)))
    expect(selectionMenuSections().map((s) => s.items.length)).toEqual([3])
  })
})
