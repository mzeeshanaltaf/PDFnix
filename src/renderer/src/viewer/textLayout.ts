/**
 * Turns the engine's words into the spans of the text layer. Pure geometry,
 * in points; the DOM is built from the result in `TextLayer`.
 */

import type { Rect, TextLine } from '@/api/engine'
import { quarterTurns } from './geometry'

export interface TextSpan {
  /** The word, followed by a space unless it ends its line. */
  text: string
  /**
   * Where the span's own top-left corner goes. The span is then turned by
   * `rotation` around that corner.
   */
  x: number
  y: number
  /** Extent along the reading direction. */
  length: number
  /** Extent across it: the height of the line. */
  thickness: number
  /** Clockwise, in degrees: 0, 90, 180 or 270. */
  rotation: 0 | 90 | 180 | 270
  endOfLine: boolean
}

/** A gap wider than this many line heights is a column break, not a space. */
const MAX_SPACE = 2

interface Placed {
  x: number
  y: number
  /** Position of the word's start along the reading direction. */
  start: number
  length: number
  thickness: number
}

function place(bbox: Rect, rotation: 0 | 90 | 180 | 270): Placed {
  const [x0, y0, x1, y1] = bbox
  switch (rotation) {
    case 90: // reads downwards
      return { x: x1, y: y0, start: y0, length: y1 - y0, thickness: x1 - x0 }
    case 180: // reads right to left, upside down
      return { x: x1, y: y1, start: -x1, length: x1 - x0, thickness: y1 - y0 }
    case 270: // reads upwards
      return { x: x0, y: y1, start: -y1, length: y1 - y0, thickness: x1 - x0 }
    default:
      return { x: x0, y: y0, start: x0, length: x1 - x0, thickness: y1 - y0 }
  }
}

/**
 * The spans of one line. Each span normally reaches to the start of the next
 * word, so that a selection is one unbroken band along the line.
 */
export function layoutLine(line: TextLine): TextSpan[] {
  const rotation = quarterTurns(line.angle)
  const placed = line.words.map((word) => place(word.bbox, rotation))
  const spans: TextSpan[] = []

  line.words.forEach((word, index) => {
    const current = placed[index]
    if (current.length <= 0 || current.thickness <= 0 || word.text.length === 0) return
    const next = placed[index + 1]
    const endOfLine = index === line.words.length - 1

    let length = current.length
    if (next) {
      const advance = next.start - current.start
      const gap = advance - current.length
      if (gap > 0 && gap <= MAX_SPACE * current.thickness) length = advance
    }

    spans.push({
      text: endOfLine ? word.text : `${word.text} `,
      x: current.x,
      y: current.y,
      length,
      thickness: current.thickness,
      rotation,
      endOfLine
    })
  })

  // If the last word was skipped, the line still has to end somewhere.
  if (spans.length > 0) spans[spans.length - 1].endOfLine = true
  return spans
}
