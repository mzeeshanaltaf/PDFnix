/**
 * The page organiser's selection and drag-to-reorder arithmetic. Pages are
 * 0-based indexes; a "gap" is a position between pages: gap 0 is before the
 * first page, gap `pageCount` after the last.
 */

export interface PageSelection {
  /** Selected pages, ascending. */
  pages: number[]
  /** Where a Shift-click range starts. */
  anchor: number | null
}

export const EMPTY_SELECTION: PageSelection = { pages: [], anchor: null }

/**
 * A click on page `index`: alone, it selects just that page; with `toggle`
 * (Ctrl) it adds or removes it; with `range` (Shift) it selects from the
 * anchor to it (added to the selection when `toggle` is also held).
 */
export function clickSelect(
  selection: PageSelection,
  index: number,
  modifiers: { toggle?: boolean; range?: boolean } = {}
): PageSelection {
  const { toggle = false, range = false } = modifiers
  if (range && selection.anchor !== null) {
    const from = Math.min(selection.anchor, index)
    const to = Math.max(selection.anchor, index)
    const span = Array.from({ length: to - from + 1 }, (_, offset) => from + offset)
    const pages = toggle ? union(selection.pages, span) : span
    return { pages, anchor: selection.anchor }
  }
  if (toggle) {
    const has = selection.pages.includes(index)
    return {
      pages: has
        ? selection.pages.filter((page) => page !== index)
        : union(selection.pages, [index]),
      anchor: index
    }
  }
  return { pages: [index], anchor: index }
}

function union(a: readonly number[], b: readonly number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y)
}

export function selectAll(pageCount: number): PageSelection {
  return { pages: Array.from({ length: pageCount }, (_, index) => index), anchor: 0 }
}

/** Drops pages that no longer exist. */
export function clampSelection(selection: PageSelection, pageCount: number): PageSelection {
  const pages = selection.pages.filter((page) => page < pageCount)
  if (pages.length === selection.pages.length) return selection
  return {
    pages,
    anchor: selection.anchor !== null && selection.anchor < pageCount ? selection.anchor : null
  }
}

/**
 * The new page order after moving `moving` (kept in their order) to `gap`.
 * Null if nothing would change.
 */
export function moveOrder(
  pageCount: number,
  moving: readonly number[],
  gap: number
): number[] | null {
  const set = new Set(moving)
  if (set.size === 0) return null
  const block = [...set].sort((a, b) => a - b)
  const before: number[] = []
  const after: number[] = []
  for (let page = 0; page < pageCount; page++) {
    if (set.has(page)) continue
    if (page < gap) before.push(page)
    else after.push(page)
  }
  const order = [...before, ...block, ...after]
  return order.every((page, index) => page === index) ? null : order
}

/** Where the moved pages end up (their new indexes) after `moveOrder`. */
export function movedIndexes(pageCount: number, moving: readonly number[], gap: number): number[] {
  const set = new Set(moving)
  let start = 0
  for (let page = 0; page < Math.min(gap, pageCount); page++) if (!set.has(page)) start++
  return Array.from({ length: set.size }, (_, offset) => start + offset)
}

/** The gap a pointer over page `index` points at: before it in its first half. */
export function gapAt(index: number, firstHalf: boolean): number {
  return firstHalf ? index : index + 1
}

/** The order that moves one page by `delta` (-1 up, +1 down); null at the ends. */
export function nudgeOrder(
  pageCount: number,
  moving: readonly number[],
  delta: -1 | 1
): {
  order: number[]
  moved: number[]
} | null {
  if (moving.length === 0) return null
  const sorted = [...new Set(moving)].sort((a, b) => a - b)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (delta < 0 && first === 0) return null
  if (delta > 0 && last === pageCount - 1) return null
  // Move the block past the neighbour on that side.
  const gap = delta < 0 ? first - 1 : last + 2
  const order = moveOrder(pageCount, sorted, gap)
  if (!order) return null
  return { order, moved: movedIndexes(pageCount, sorted, gap) }
}
