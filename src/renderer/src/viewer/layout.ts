/**
 * Where every page sits in the scrolling view. Pure arithmetic: page sizes in
 * points go in, boxes in CSS pixels come out, so the scrollbar is right before
 * any image has loaded and only the pages near the viewport need mounting.
 */

import type { LayoutMode } from '../../../shared/api'
import { cssScale, type Point, type Size } from './geometry'

/** Space between pages, and between the pages and the edge of the view. */
export const PAGE_GAP = 12
export const VIEW_PADDING = 16

export interface PageBox {
  /** 0-based page index. */
  index: number
  left: number
  top: number
  width: number
  height: number
}

export interface LayoutRow {
  top: number
  height: number
  boxes: PageBox[]
}

export interface DocumentLayout {
  mode: LayoutMode
  /** CSS pixels per point. */
  scale: number
  rows: LayoutRow[]
  byIndex: Map<number, PageBox>
  width: number
  height: number
}

/** A place in the document that survives zooming: a page and a point on it. */
export interface Anchor {
  page: number
  /** Points from the page's top-left corner; may lie outside the page. */
  x: number
  y: number
}

function groups(pageCount: number, mode: LayoutMode, currentPage: number): number[][] {
  if (pageCount === 0) return []
  if (mode === 'single') return [[Math.min(Math.max(currentPage, 0), pageCount - 1)]]
  const result: number[][] = []
  const step = mode === 'two-page' ? 2 : 1
  for (let first = 0; first < pageCount; first += step) {
    result.push(step === 2 && first + 1 < pageCount ? [first, first + 1] : [first])
  }
  return result
}

/**
 * Lays the pages out. In `single` mode only `currentPage` is laid out.
 * In `two-page` mode the gap between the two pages is the same line down
 * the whole document, whatever the page sizes.
 */
export function buildLayout(
  pages: readonly Size[],
  mode: LayoutMode,
  zoom: number,
  currentPage = 0
): DocumentLayout {
  const scale = cssScale(zoom)
  const sized = (index: number): Size => ({
    width: pages[index].width * scale,
    height: pages[index].height * scale
  })
  const rowsOfPages = groups(pages.length, mode, currentPage)

  let widest = 0
  for (const group of rowsOfPages) {
    for (const index of group) widest = Math.max(widest, sized(index).width)
  }
  const inner = mode === 'two-page' ? widest * 2 + PAGE_GAP : widest
  const width = inner + VIEW_PADDING * 2
  const centre = width / 2

  const rows: LayoutRow[] = []
  const byIndex = new Map<number, PageBox>()
  let top = VIEW_PADDING
  for (const group of rowsOfPages) {
    const sizes = group.map(sized)
    const height = Math.max(...sizes.map((size) => size.height))
    const boxes = group.map((index, position): PageBox => {
      const size = sizes[position]
      let left: number
      if (mode === 'two-page') {
        left = position === 0 ? centre - PAGE_GAP / 2 - size.width : centre + PAGE_GAP / 2
      } else {
        left = centre - size.width / 2
      }
      return {
        index,
        left,
        top: top + (height - size.height) / 2,
        width: size.width,
        height: size.height
      }
    })
    for (const box of boxes) byIndex.set(box.index, box)
    rows.push({ top, height, boxes })
    top += height + PAGE_GAP
  }

  const height = rows.length > 0 ? top - PAGE_GAP + VIEW_PADDING : VIEW_PADDING * 2
  return { mode, scale, rows, byIndex, width, height }
}

/** Index of the row at height `y`: the last row that starts at or above it. */
export function rowIndexAt(layout: DocumentLayout, y: number): number {
  const { rows } = layout
  let low = 0
  let high = rows.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (rows[middle].top <= y) low = middle
    else high = middle - 1
  }
  return low
}

/**
 * The rows that intersect the band from `top` to `bottom`, widened by
 * `overscan` on both sides, as inclusive indexes. `null` if there are none.
 */
export function visibleRows(
  layout: DocumentLayout,
  top: number,
  bottom: number,
  overscan = 0
): { first: number; last: number } | null {
  const { rows } = layout
  if (rows.length === 0) return null
  const from = top - overscan
  const to = bottom + overscan

  let first = rowIndexAt(layout, from)
  // The row found may end above the band (the band starts in a gap).
  if (rows[first].top + rows[first].height < from && first < rows.length - 1) first += 1
  let last = rowIndexAt(layout, to)
  if (rows[last].top > to && last > 0) last -= 1
  return { first, last: Math.max(first, last) }
}

/**
 * The page a reader would call "the current page": the first page of which at
 * least half is in view, or failing that the one with the most in view.
 */
export function currentPageAt(layout: DocumentLayout, top: number, bottom: number): number {
  const { rows } = layout
  if (rows.length === 0) return 0
  let best = rows[rowIndexAt(layout, top)].boxes[0].index
  let bestVisible = -1
  for (let index = rowIndexAt(layout, top); index < rows.length; index += 1) {
    const row = rows[index]
    if (row.top >= bottom) break
    const visible = Math.min(bottom, row.top + row.height) - Math.max(top, row.top)
    if (visible >= row.height / 2) return row.boxes[0].index
    if (visible > bestVisible) {
      bestVisible = visible
      best = row.boxes[0].index
    }
  }
  return best
}

/** The anchor for a position in the layout (CSS pixels from its top-left). */
export function anchorAt(layout: DocumentLayout, x: number, y: number): Anchor | null {
  if (layout.rows.length === 0) return null
  const row = layout.rows[rowIndexAt(layout, y)]
  let box = row.boxes[0]
  for (const candidate of row.boxes) {
    if (x >= candidate.left - PAGE_GAP / 2) box = candidate
  }
  return {
    page: box.index,
    x: (x - box.left) / layout.scale,
    y: (y - box.top) / layout.scale
  }
}

/** Where an anchor is in the layout, or `null` if its page is not laid out. */
export function anchorPosition(layout: DocumentLayout, anchor: Anchor): Point | null {
  const box = layout.byIndex.get(anchor.page)
  if (!box) return null
  return { x: box.left + anchor.x * layout.scale, y: box.top + anchor.y * layout.scale }
}

/**
 * How far the layout is pushed in from the top-left of the viewport when it
 * is smaller than the viewport: centred horizontally, and in `single` mode
 * vertically too.
 */
export function layoutOffset(layout: DocumentLayout, viewport: Size): Point {
  return {
    x: Math.max(0, (viewport.width - layout.width) / 2),
    y: layout.mode === 'single' ? Math.max(0, (viewport.height - layout.height) / 2) : 0
  }
}
