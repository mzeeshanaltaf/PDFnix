import { describe, expect, it } from 'vitest'
import {
  clampSelection,
  clickSelect,
  EMPTY_SELECTION,
  gapAt,
  movedIndexes,
  moveOrder,
  nudgeOrder,
  selectAll
} from './organiser'

describe('clickSelect', () => {
  it('a plain click selects one page', () => {
    const selected = clickSelect({ pages: [1, 2], anchor: 1 }, 4)
    expect(selected).toEqual({ pages: [4], anchor: 4 })
  })

  it('Ctrl-click adds and removes', () => {
    let selection = clickSelect(EMPTY_SELECTION, 2)
    selection = clickSelect(selection, 5, { toggle: true })
    expect(selection.pages).toEqual([2, 5])
    selection = clickSelect(selection, 2, { toggle: true })
    expect(selection).toEqual({ pages: [5], anchor: 2 })
  })

  it('Shift-click selects from the anchor, either way', () => {
    const start = clickSelect(EMPTY_SELECTION, 3)
    expect(clickSelect(start, 6, { range: true })).toEqual({ pages: [3, 4, 5, 6], anchor: 3 })
    expect(clickSelect(start, 1, { range: true })).toEqual({ pages: [1, 2, 3], anchor: 3 })
  })

  it('Ctrl+Shift-click adds the range to the selection', () => {
    let selection = clickSelect(EMPTY_SELECTION, 0)
    selection = clickSelect(selection, 5, { toggle: true })
    selection = clickSelect(selection, 7, { toggle: true, range: true })
    expect(selection.pages).toEqual([0, 5, 6, 7])
  })

  it('Shift-click without an anchor is a plain click', () => {
    expect(clickSelect(EMPTY_SELECTION, 2, { range: true })).toEqual({ pages: [2], anchor: 2 })
  })
})

describe('selection upkeep', () => {
  it('select all', () => {
    expect(selectAll(3)).toEqual({ pages: [0, 1, 2], anchor: 0 })
  })

  it('drops pages that are gone', () => {
    expect(clampSelection({ pages: [1, 4, 5], anchor: 5 }, 5)).toEqual({
      pages: [1, 4],
      anchor: null
    })
    const kept = { pages: [1], anchor: 1 }
    expect(clampSelection(kept, 5)).toBe(kept)
  })
})

describe('moveOrder', () => {
  it('moves one page forward and back', () => {
    // Page 1 to the gap before page 4.
    expect(moveOrder(6, [1], 4)).toEqual([0, 2, 3, 1, 4, 5])
    // Page 4 to the start.
    expect(moveOrder(6, [4], 0)).toEqual([4, 0, 1, 2, 3, 5])
    // To the end.
    expect(moveOrder(6, [0], 6)).toEqual([1, 2, 3, 4, 5, 0])
  })

  it('moves several pages as one block in their order', () => {
    expect(moveOrder(8, [6, 1, 3], 5)).toEqual([0, 2, 4, 1, 3, 6, 5, 7])
  })

  it('a drop next to itself changes nothing', () => {
    expect(moveOrder(6, [2], 2)).toBeNull()
    expect(moveOrder(6, [2], 3)).toBeNull()
    expect(moveOrder(6, [2, 3], 4)).toBeNull()
    expect(moveOrder(6, [], 4)).toBeNull()
  })

  it('reports where the moved pages land', () => {
    expect(movedIndexes(6, [1], 4)).toEqual([3])
    expect(movedIndexes(8, [6, 1, 3], 5)).toEqual([3, 4, 5])
    expect(movedIndexes(6, [4], 0)).toEqual([0])
    expect(movedIndexes(6, [0], 6)).toEqual([5])
  })
})

describe('gapAt and nudgeOrder', () => {
  it('the first half of a page is the gap before it', () => {
    expect(gapAt(3, true)).toBe(3)
    expect(gapAt(3, false)).toBe(4)
  })

  it('nudges a page or block by one', () => {
    expect(nudgeOrder(5, [2], -1)).toEqual({ order: [0, 2, 1, 3, 4], moved: [1] })
    expect(nudgeOrder(5, [1, 2], 1)).toEqual({ order: [0, 3, 1, 2, 4], moved: [2, 3] })
    expect(nudgeOrder(5, [0], -1)).toBeNull()
    expect(nudgeOrder(5, [4], 1)).toBeNull()
  })
})
