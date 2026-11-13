/**
 * Geometry for the viewer: points to pixels, and what a rotation does to
 * coordinates. All conversions between PDF points and CSS pixels go through
 * here (the arithmetic itself lives in `lib/units.ts`).
 *
 * Engine coordinates are PDF points in the page's displayed (rotated) space,
 * origin top-left, y pointing down.
 */

import type { Quad, Rect } from '@/api/engine'
import { CSS_PX_PER_PT, ptToPx, pxToPt } from '@/lib/units'

export { CSS_PX_PER_PT, ptToPx, pxToPt }

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** A box in CSS pixels, ready for `style`. */
export interface PxBox {
  left: number
  top: number
  width: number
  height: number
}

/** The engine never renders a page image larger than this (see render.py). */
export const MAX_RENDER_PIXELS = 40_000_000

/** CSS pixels per point at a zoom level (1 = 100 %). */
export function cssScale(zoom: number): number {
  return zoom * CSS_PX_PER_PT
}

export function sizeToPx(size: Size, zoom: number): Size {
  return { width: ptToPx(size.width, zoom), height: ptToPx(size.height, zoom) }
}

export function rectToPx(rect: Rect, zoom: number): PxBox {
  return {
    left: ptToPx(rect[0], zoom),
    top: ptToPx(rect[1], zoom),
    width: ptToPx(rect[2] - rect[0], zoom),
    height: ptToPx(rect[3] - rect[1], zoom)
  }
}

/** The smallest upright rectangle around a quad. */
export function quadBounds(quad: Quad): Rect {
  const xs = [quad[0], quad[2], quad[4], quad[6]]
  const ys = [quad[1], quad[3], quad[5], quad[7]]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/**
 * Image pixels per point to ask the engine for: one image pixel per device
 * pixel, limited by the engine's pixel budget for a single page.
 */
export function renderScale(zoom: number, devicePixelRatio: number, page: Size): number {
  const wanted = cssScale(zoom) * devicePixelRatio
  const area = page.width * page.height
  const limit = area > 0 ? Math.sqrt(MAX_RENDER_PIXELS / area) : wanted
  return Math.round(Math.min(wanted, limit) * 1000) / 1000
}

/** Any angle as one of 0, 90, 180, 270 (the nearest quarter turn). */
export function quarterTurns(degrees: number): 0 | 90 | 180 | 270 {
  const turned = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360
  return turned as 0 | 90 | 180 | 270
}

/** The size of a page after turning it by `degrees`. */
export function rotatedSize(size: Size, degrees: number): Size {
  const turn = quarterTurns(degrees)
  return turn === 90 || turn === 270 ? { width: size.height, height: size.width } : { ...size }
}

/**
 * Where a point of a page ends up when the page is turned clockwise by
 * `degrees`. `size` is the page size before the turn; the result is in the
 * turned page's own space (origin at its top-left).
 */
export function rotatePoint(point: Point, size: Size, degrees: number): Point {
  switch (quarterTurns(degrees)) {
    case 90:
      return { x: size.height - point.y, y: point.x }
    case 180:
      return { x: size.width - point.x, y: size.height - point.y }
    case 270:
      return { x: point.y, y: size.width - point.x }
    default:
      return { ...point }
  }
}

/** `rotatePoint` for a rectangle; the result is upright again. */
export function rotateRect(rect: Rect, size: Size, degrees: number): Rect {
  const a = rotatePoint({ x: rect[0], y: rect[1] }, size, degrees)
  const b = rotatePoint({ x: rect[2], y: rect[3] }, size, degrees)
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]
}

/** `rotatePoint` for each corner of a quad. The corner order is kept. */
export function rotateQuad(quad: Quad, size: Size, degrees: number): Quad {
  const result: number[] = []
  for (let corner = 0; corner < 8; corner += 2) {
    const moved = rotatePoint({ x: quad[corner], y: quad[corner + 1] }, size, degrees)
    result.push(moved.x, moved.y)
  }
  return result as Quad
}
