import type { Rect, TextBlock } from '@/api/engine'
import type { EditTextStyle } from '@/state/pending'
import type { Point } from '@/viewer/geometry'

function area(rect: Rect): number {
  return (rect[2] - rect[0]) * (rect[3] - rect[1])
}

/**
 * The block whose box contains `point` (points, displayed space); the
 * smallest one when boxes overlap. Null if none does.
 */
export function blockForPoint<T extends { bbox: Rect }>(
  blocks: readonly T[],
  point: Point
): T | null {
  let best: T | null = null
  for (const block of blocks) {
    const [x0, y0, x1, y1] = block.bbox
    if (point.x < x0 || point.x > x1 || point.y < y0 || point.y > y1) continue
    if (!best || area(block.bbox) < area(best.bbox)) best = block
  }
  return best
}

/** The style of a text block, from its most used span. */
export function blockStyle(block: TextBlock): { style: EditTextStyle; fontName: string } {
  const weights = new Map<string, { span: TextBlock['lines'][0]['spans'][0]; count: number }>()
  for (const line of block.lines) {
    for (const span of line.spans) {
      const key = `${span.font}|${span.size}|${span.color}|${span.flags}`
      const entry = weights.get(key) ?? { span, count: 0 }
      entry.count += span.text.trim().length
      weights.set(key, entry)
    }
  }
  const span = [...weights.values()].sort((a, b) => b.count - a.count)[0]?.span
  const name = span?.font ?? ''
  const lowered = name.toLowerCase()
  const flags = span?.flags ?? 0
  const lefts = block.lines.map((line) => line.bbox[0])
  const rights = block.lines.map((line) => line.bbox[2])
  const spread = (values: number[]): number => Math.max(...values) - Math.min(...values)
  // Edges along x only mean something for text that reads left to right.
  const align =
    block.angle !== 0 || block.lines.length < 2 || spread(lefts) <= 1.5
      ? 'left'
      : spread(rights.slice(0, -1)) <= 1.5
        ? 'right'
        : 'center'
  return {
    fontName: name,
    style: {
      fontFamily: null,
      fontSize: span?.size ?? 12,
      color: span?.color ?? '#000000',
      bold: (flags & 16) !== 0 || /bold|black|heavy/.test(lowered),
      italic: (flags & 2) !== 0 || /italic|oblique/.test(lowered),
      align
    }
  }
}
