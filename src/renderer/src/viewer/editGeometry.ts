/**
 * Geometry for objects being placed and edited on a page: moving, resizing
 * (optionally keeping the aspect ratio), quarter turns, drawing strokes.
 *
 * Everything is in PDF points in the page's displayed space, the same space
 * the engine uses, so a page's own rotation needs no special handling here.
 * Pointer movements arrive in CSS pixels; `pxToPt` turns them into points.
 */

import type { Rect } from '@/api/engine'
import { pxToPt } from '@/lib/units'
import type { Point, Size } from './geometry'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Corner handles; the others are edge handles. */
export function isCorner(handle: Handle): boolean {
  return handle.length === 2
}

/** Smallest width or height of a box, in points. */
export const MIN_SIZE = 4

export function rectWidth(rect: Rect): number {
  return rect[2] - rect[0]
}

export function rectHeight(rect: Rect): number {
  return rect[3] - rect[1]
}

export function rectCenter(rect: Rect): Point {
  return { x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 }
}

export function normalizeRect(rect: Rect): Rect {
  return [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
    Math.max(rect[0], rect[2]),
    Math.max(rect[1], rect[3])
  ]
}

export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy]
}

/** A pointer movement in CSS pixels as points at `zoom`. */
export function pxToPtDelta(dx: number, dy: number, zoom: number): Point {
  return { x: pxToPt(dx, zoom), y: pxToPt(dy, zoom) }
}

/**
 * `rect` moved (not resized) so that it lies on the page. A box larger than
 * the page is aligned with the page's top-left corner.
 */
export function clampToPage(rect: Rect, page: Size): Rect {
  const width = rectWidth(rect)
  const height = rectHeight(rect)
  const x0 = width >= page.width ? 0 : Math.min(Math.max(rect[0], 0), page.width - width)
  const y0 = height >= page.height ? 0 : Math.min(Math.max(rect[1], 0), page.height - height)
  return [x0, y0, x0 + width, y0 + height]
}

export interface ResizeOptions {
  /** Width divided by height to keep, or null for a free resize. */
  aspect?: number | null
  min?: number
}

/**
 * The box after dragging `handle` by (dx, dy) points. The opposite edge or
 * corner stays put. With an aspect ratio, a corner follows whichever of its
 * two directions moved further, and an edge handle grows the other
 * dimension evenly about the box's centre line.
 */
export function resizeRect(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  options: ResizeOptions = {}
): Rect {
  const min = options.min ?? MIN_SIZE
  let [x0, y0, x1, y1] = rect
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')
  if (west) x0 = Math.min(x0 + dx, x1 - min)
  if (east) x1 = Math.max(x1 + dx, x0 + min)
  if (north) y0 = Math.min(y0 + dy, y1 - min)
  if (south) y1 = Math.max(y1 + dy, y0 + min)

  const aspect = options.aspect
  if (!aspect || aspect <= 0) return [x0, y0, x1, y1]

  let width = x1 - x0
  let height = y1 - y0
  if (isCorner(handle)) {
    // Follow the direction that changed more, relative to the old size.
    const widthChange = width / rectWidth(rect)
    const heightChange = height / rectHeight(rect)
    if (Math.abs(widthChange - 1) >= Math.abs(heightChange - 1)) height = width / aspect
    else width = height * aspect
    if (width < min || height < min) {
      const scale = Math.max(min / width, min / height)
      width *= scale
      height *= scale
    }
    if (west) x0 = x1 - width
    else x1 = x0 + width
    if (north) y0 = y1 - height
    else y1 = y0 + height
    return [x0, y0, x1, y1]
  }
  if (east || west) {
    height = Math.max(width / aspect, min)
    width = height * aspect
    if (west) x0 = x1 - width
    else x1 = x0 + width
    const middle = (rect[1] + rect[3]) / 2
    return [x0, middle - height / 2, x1, middle + height / 2]
  }
  width = Math.max(height * aspect, min)
  height = width / aspect
  if (north) y0 = y1 - height
  else y1 = y0 + height
  const middle = (rect[0] + rect[2]) / 2
  return [middle - width / 2, y0, middle + width / 2, y1]
}

/** The box turned a quarter turn about its centre: width and height swap. */
export function quarterTurnRect(rect: Rect): Rect {
  const center = rectCenter(rect)
  const halfWidth = rectHeight(rect) / 2
  const halfHeight = rectWidth(rect) / 2
  return [center.x - halfWidth, center.y - halfHeight, center.x + halfWidth, center.y + halfHeight]
}

/** The box spanned by a drag from `a` to `b`; `square` keeps it square. */
export function rectFromDrag(a: Point, b: Point, square = false): Rect {
  let dx = b.x - a.x
  let dy = b.y - a.y
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * side
    dy = Math.sign(dy || 1) * side
  }
  return normalizeRect([a.x, a.y, a.x + dx, a.y + dy])
}

/**
 * The end point of a line drawn from `a` towards `b`; with `snap`, the angle
 * snaps to multiples of 45 degrees.
 */
export function lineEnd(a: Point, b: Point, snap = false): Point {
  if (!snap) return b
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const step = Math.PI / 4
  const snapped = Math.round(angle / step) * step
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: a.x + Math.cos(snapped) * length, y: a.y + Math.sin(snapped) * length }
}

/** The smallest box around some points. */
export function pointsBounds(points: readonly Point[]): Rect {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * A point of a box mapped into another box, scaling each axis. A box with no
 * width (or height) only moves along that axis.
 */
export function mapPoint(point: Point, from: Rect, to: Rect): Point {
  const width = rectWidth(from)
  const height = rectHeight(from)
  return {
    x:
      width < 1e-6
        ? to[0] + (point.x - from[0])
        : to[0] + ((point.x - from[0]) * rectWidth(to)) / width,
    y:
      height < 1e-6
        ? to[1] + (point.y - from[1])
        : to[1] + ((point.y - from[1]) * rectHeight(to)) / height
  }
}

/** A size scaled down (never up) to fit inside `limit`, keeping its shape. */
export function fitInside(size: Size, limit: Size): Size {
  const scale = Math.min(1, limit.width / size.width, limit.height / size.height)
  return { width: size.width * scale, height: size.height * scale }
}

/** A box of `size` centred on `center`, kept on the page. */
export function boxAround(center: Point, size: Size, page: Size): Rect {
  return clampToPage(
    [
      center.x - size.width / 2,
      center.y - size.height / 2,
      center.x + size.width / 2,
      center.y + size.height / 2
    ],
    page
  )
}

/**
 * A freehand stroke cleaned up for storing: points closer than `minStep` to
 * the previous kept point are dropped, then corners are rounded with one pass
 * of Chaikin's algorithm. The first and last points are kept.
 */
export function smoothStroke(points: readonly Point[], minStep = 0.75): Point[] {
  if (points.length === 0) return []
  const kept: Point[] = [points[0]]
  for (const point of points.slice(1)) {
    const last = kept[kept.length - 1]
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minStep) kept.push(point)
  }
  const final = points[points.length - 1]
  const tail = kept[kept.length - 1]
  if (kept.length > 1 && (tail.x !== final.x || tail.y !== final.y)) kept.push(final)
  if (kept.length < 3) return kept
  const smooth: Point[] = [kept[0]]
  for (let index = 0; index < kept.length - 1; index += 1) {
    const a = kept[index]
    const b = kept[index + 1]
    smooth.push(
      { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
      { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y }
    )
  }
  smooth.push(kept[kept.length - 1])
  return smooth
}
