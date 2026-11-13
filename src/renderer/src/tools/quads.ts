/**
 * Turns selected text into the quads of a text markup annotation.
 *
 * The selection arrives as pieces of words (a word box from the text layer
 * and which part of it is selected). Pieces of the same line are merged into
 * one quad, so a highlight is one band per line, not one box per word.
 *
 * Everything is in points in the page's displayed space. Quad corners are in
 * the order the engine uses for text: upper-left, upper-right, lower-left,
 * lower-right *as seen along the text*, so on a page rotated by 90 degrees
 * the "upper-left" corner is at the top right of the box on screen.
 */

import type { Quad, Rect } from '@/api/engine'
import { quarterTurns } from '@/viewer/geometry'

export interface WordPiece {
  /** 0-based page index. */
  page: number
  /** Index of the word's line on the page. */
  line: number
  /** Reading direction of the line, in degrees (0, 90, 180, 270). */
  angle: number
  /** The whole word's box. */
  bbox: Rect
  /** Selected part of the word along the reading direction, 0 to 1. */
  from: number
  to: number
}

export interface MarkupGroup {
  page: number
  quads: Quad[]
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/** The selected part of a word's box. */
export function pieceRect(piece: WordPiece): Rect {
  const [x0, y0, x1, y1] = piece.bbox
  const from = clamp01(Math.min(piece.from, piece.to))
  const to = clamp01(Math.max(piece.from, piece.to))
  const width = x1 - x0
  const height = y1 - y0
  switch (quarterTurns(piece.angle)) {
    case 90: // reads downwards
      return [x0, y0 + from * height, x1, y0 + to * height]
    case 180: // reads right to left
      return [x1 - to * width, y0, x1 - from * width, y1]
    case 270: // reads upwards
      return [x0, y1 - to * height, x1, y1 - from * height]
    default:
      return [x0 + from * width, y0, x0 + to * width, y1]
  }
}

/** The quad of an upright box holding text that reads in direction `angle`. */
export function textQuad(rect: Rect, angle: number): Quad {
  const [x0, y0, x1, y1] = rect
  switch (quarterTurns(angle)) {
    case 90:
      return [x1, y0, x1, y1, x0, y0, x0, y1]
    case 180:
      return [x1, y1, x0, y1, x1, y0, x0, y0]
    case 270:
      return [x0, y1, x0, y0, x1, y1, x1, y0]
    default:
      return [x0, y0, x1, y0, x0, y1, x1, y1]
  }
}

function union(a: Rect, b: Rect): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

/**
 * One quad per selected line, grouped by page. Pages and lines keep the order
 * in which they first appear among the pieces (document order). Pieces that
 * select nothing are ignored.
 */
export function piecesToMarkup(pieces: readonly WordPiece[]): MarkupGroup[] {
  const pages = new Map<number, Map<number, { rect: Rect; angle: number }>>()
  for (const piece of pieces) {
    if (Math.abs(clamp01(piece.to) - clamp01(piece.from)) < 1e-6) continue
    const rect = pieceRect(piece)
    if (rect[2] - rect[0] <= 0 || rect[3] - rect[1] <= 0) continue
    let lines = pages.get(piece.page)
    if (!lines) {
      lines = new Map()
      pages.set(piece.page, lines)
    }
    const known = lines.get(piece.line)
    if (known) known.rect = union(known.rect, rect)
    else lines.set(piece.line, { rect, angle: piece.angle })
  }
  return [...pages].map(([page, lines]) => ({
    page,
    quads: [...lines.values()].map(({ rect, angle }) => textQuad(rect, angle))
  }))
}
