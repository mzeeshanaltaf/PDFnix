/** Which annotation is at a point of a page. Pure geometry, in points. */

import type { Annotation, Quad, Rect } from '@/api/engine'
import type { Point } from '@/viewer/geometry'

/** How far outside its shape a click still counts, in points. */
const TOLERANCE = 2

function inRect(point: Point, rect: Rect, slack = TOLERANCE): boolean {
  return (
    point.x >= rect[0] - slack &&
    point.x <= rect[2] + slack &&
    point.y >= rect[1] - slack &&
    point.y <= rect[3] + slack
  )
}

function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

/** Inside a (convex) quad, corners in the engine's ul, ur, ll, lr order. */
export function inQuad(point: Point, quad: Quad): boolean {
  // Walk the outline: ul -> ur -> lr -> ll.
  const xs = [quad[0], quad[2], quad[6], quad[4]]
  const ys = [quad[1], quad[3], quad[7], quad[5]]
  let sign = 0
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4
    const value = cross(xs[i], ys[i], xs[j], ys[j], point.x, point.y)
    if (Math.abs(value) < 1e-9) continue
    const current = Math.sign(value)
    if (sign === 0) sign = current
    else if (current !== sign) return false
  }
  return true
}

function quadBox(quad: Quad): Rect {
  const xs = [quad[0], quad[2], quad[4], quad[6]]
  const ys = [quad[1], quad[3], quad[5], quad[7]]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Annotations that sit on top of the text: notes and everything that is not markup. */
export function isMarkup(annotation: Annotation): boolean {
  return annotation.quads !== undefined && annotation.quads.length > 0
}

/**
 * The annotation at `point`. Annotations drawn later are on top; among them,
 * those with their own body (notes, boxes) win over text markup, which lies
 * under the text.
 */
export function annotationAt(annotations: readonly Annotation[], point: Point): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const annotation = annotations[i]
    if (!isMarkup(annotation) && inRect(point, annotation.rect)) return annotation
  }
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const annotation = annotations[i]
    if (!isMarkup(annotation)) continue
    for (const quad of annotation.quads ?? []) {
      if (inQuad(point, quad) || inRect(point, quadBox(quad), TOLERANCE / 2)) return annotation
    }
  }
  return null
}
