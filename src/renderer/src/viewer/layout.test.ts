import { describe, expect, it } from 'vitest'
import { cssScale } from './geometry'
import {
  anchorAt,
  anchorPosition,
  buildLayout,
  currentPageAt,
  layoutOffset,
  PAGE_GAP,
  VIEW_PADDING,
  visibleRows
} from './layout'

const A4 = { width: 595, height: 842 }
const LANDSCAPE = { width: 842, height: 595 }
const pages = (count: number): { width: number; height: number }[] =>
  Array.from({ length: count }, () => A4)

describe('buildLayout', () => {
  it('stacks pages with gaps, and is sized before any image exists', () => {
    const layout = buildLayout(pages(3), 'continuous', 1)
    const height = A4.height * cssScale(1)
    expect(layout.rows).toHaveLength(3)
    expect(layout.rows[0].top).toBe(VIEW_PADDING)
    expect(layout.rows[1].top).toBeCloseTo(VIEW_PADDING + height + PAGE_GAP)
    expect(layout.height).toBeCloseTo(VIEW_PADDING * 2 + height * 3 + PAGE_GAP * 2)
  })

  it('centres narrower pages', () => {
    const layout = buildLayout([A4, LANDSCAPE], 'continuous', 1)
    const narrow = layout.byIndex.get(0)!
    const wide = layout.byIndex.get(1)!
    expect(wide.left).toBeCloseTo(VIEW_PADDING)
    expect(narrow.left + narrow.width / 2).toBeCloseTo(layout.width / 2)
  })

  it('puts two pages per row in two-page mode, with an odd last page alone', () => {
    const layout = buildLayout(pages(5), 'two-page', 1)
    expect(layout.rows.map((row) => row.boxes.map((box) => box.index))).toEqual([
      [0, 1],
      [2, 3],
      [4]
    ])
    const [left, right] = layout.rows[0].boxes
    expect(right.left - (left.left + left.width)).toBeCloseTo(PAGE_GAP)
  })

  it('lays out only the current page in single mode', () => {
    const layout = buildLayout(pages(5), 'single', 1, 3)
    expect(layout.rows).toHaveLength(1)
    expect([...layout.byIndex.keys()]).toEqual([3])
  })

  it('is empty for no pages', () => {
    const layout = buildLayout([], 'continuous', 1)
    expect(layout.rows).toEqual([])
    expect(currentPageAt(layout, 0, 100)).toBe(0)
    expect(visibleRows(layout, 0, 100)).toBeNull()
  })
})

describe('what is in view', () => {
  const layout = buildLayout(pages(100), 'continuous', 1)
  const rowHeight = A4.height * cssScale(1) + PAGE_GAP

  it('finds the rows in a band, with overscan', () => {
    const top = VIEW_PADDING + rowHeight * 10 + 50
    expect(visibleRows(layout, top, top + 600)).toEqual({ first: 10, last: 10 })
    expect(visibleRows(layout, top, top + 1200)).toEqual({ first: 10, last: 11 })
    expect(visibleRows(layout, top, top + 600, 800)).toEqual({ first: 9, last: 11 })
  })

  it('clamps at both ends', () => {
    expect(visibleRows(layout, -500, 10)?.first).toBe(0)
    expect(visibleRows(layout, layout.height - 10, layout.height + 500)?.last).toBe(99)
  })

  it('calls the page that fills most of the view the current page', () => {
    const top = VIEW_PADDING + rowHeight * 20
    expect(currentPageAt(layout, top, top + 600)).toBe(20)
    // Only the bottom 100 px of page 20 left in view: page 21 is current.
    expect(currentPageAt(layout, top + rowHeight - 100, top + rowHeight + 500)).toBe(21)
  })
})

describe('anchors survive zooming', () => {
  it('maps a position to a page point and back', () => {
    const layout = buildLayout(pages(10), 'continuous', 1)
    const box = layout.byIndex.get(4)!
    const anchor = anchorAt(layout, box.left + 100, box.top + 200)!
    expect(anchor.page).toBe(4)
    expect(anchor.x).toBeCloseTo(100 / cssScale(1))
    expect(anchorPosition(layout, anchor)).toEqual({ x: box.left + 100, y: box.top + 200 })
  })

  it('points at the same spot of the page at another zoom', () => {
    const small = buildLayout(pages(10), 'continuous', 1)
    const big = buildLayout(pages(10), 'continuous', 3)
    const box = small.byIndex.get(6)!
    const anchor = anchorAt(small, box.left + box.width / 2, box.top + box.height / 4)!
    const moved = anchorPosition(big, anchor)!
    const bigBox = big.byIndex.get(6)!
    expect((moved.x - bigBox.left) / bigBox.width).toBeCloseTo(0.5)
    expect((moved.y - bigBox.top) / bigBox.height).toBeCloseTo(0.25)
  })

  it('picks the right page of a two-page row', () => {
    const layout = buildLayout(pages(4), 'two-page', 1)
    const right = layout.byIndex.get(1)!
    expect(anchorAt(layout, right.left + 10, right.top + 10)?.page).toBe(1)
    const left = layout.byIndex.get(0)!
    expect(anchorAt(layout, left.left + 10, left.top + 10)?.page).toBe(0)
  })

  it('has no position for a page that is not laid out', () => {
    const layout = buildLayout(pages(4), 'single', 1, 0)
    expect(anchorPosition(layout, { page: 2, x: 0, y: 0 })).toBeNull()
  })
})

describe('layoutOffset', () => {
  it('centres a narrow layout horizontally, and vertically only in single mode', () => {
    const continuous = buildLayout(pages(1), 'continuous', 0.25)
    const single = buildLayout(pages(1), 'single', 0.25)
    const viewport = { width: 1000, height: 800 }
    expect(layoutOffset(continuous, viewport).x).toBeCloseTo((1000 - continuous.width) / 2)
    expect(layoutOffset(continuous, viewport).y).toBe(0)
    expect(layoutOffset(single, viewport).y).toBeCloseTo((800 - single.height) / 2)
  })

  it('is zero when the layout is larger than the view', () => {
    const layout = buildLayout(pages(3), 'continuous', 4)
    expect(layoutOffset(layout, { width: 800, height: 600 })).toEqual({ x: 0, y: 0 })
  })
})
