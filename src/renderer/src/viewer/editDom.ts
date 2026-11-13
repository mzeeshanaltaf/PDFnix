/** Helpers shared by the edit overlay and the annotation layer. */

import type { FontFamily } from '@/api/engine'
import { pxToPtDelta } from './editGeometry'
import type { Point } from './geometry'

/** Line height of text boxes, as the engine lays them out. */
export const TEXT_LINE_HEIGHT = 1.2

/** CSS fonts that match the engine's built-in families. */
export const CSS_FONTS: Record<FontFamily, string> = {
  sans: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace'
}

/**
 * Follows a pointer drag that started on the event's element: calls `onMove`
 * with the movement in points since the start, and `onEnd` when the button is
 * released (`moved` is false for a click).
 */
export function trackDrag(
  event: React.PointerEvent<HTMLElement>,
  zoom: number,
  onMove: (delta: Point, move: PointerEvent) => void,
  onEnd?: (delta: Point, moved: boolean) => void
): void {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const element = event.currentTarget
  const start = { x: event.clientX, y: event.clientY }
  let delta = { x: 0, y: 0 }
  let moved = false
  element.setPointerCapture(event.pointerId)
  const move = (pointer: PointerEvent): void => {
    if (Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y) > 2) moved = true
    delta = pxToPtDelta(pointer.clientX - start.x, pointer.clientY - start.y, zoom)
    onMove(delta, pointer)
  }
  const end = (): void => {
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', end)
    element.removeEventListener('pointercancel', end)
    onEnd?.(delta, moved)
  }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', end)
  element.addEventListener('pointercancel', end)
}
