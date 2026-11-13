import type { LayoutMode } from '../../../shared/api'
import { CSS_PX_PER_PT, type Size } from './geometry'
import { PAGE_GAP, VIEW_PADDING } from './layout'

/** 1 = 100 %. */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

/** How the zoom is chosen: by the user, or to fit the window. */
export type ZoomMode = 'custom' | 'fit-width' | 'fit-page'

/** Offered in the zoom box. */
export const ZOOM_PRESETS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8]

/** The stops used by the zoom in / zoom out buttons and Ctrl + / Ctrl -. */
const ZOOM_STEPS: readonly number[] = [
  0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
  6, 8
]

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** The next stop above (`1`) or below (`-1`) the current zoom. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const epsilon = 0.001
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => step > zoom + epsilon) ?? MAX_ZOOM
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - epsilon) ?? MIN_ZOOM
}

/** Zoom after a Ctrl+wheel movement; one notch of a mouse wheel is about 16 %. */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY * 0.0015))
}

/**
 * The zoom at which the pages fit the viewport's width, or fit it entirely.
 * It is based on the largest page so it does not change while scrolling; in
 * `single` layout, where one page is shown at a time, on that page.
 */
export function fitZoom(
  mode: 'fit-width' | 'fit-page',
  viewport: Size,
  pages: readonly Size[],
  layout: LayoutMode,
  currentPage: number
): number {
  if (pages.length === 0 || viewport.width <= 0 || viewport.height <= 0) return 1
  const considered =
    layout === 'single' ? [pages[Math.min(Math.max(currentPage, 0), pages.length - 1)]] : pages

  let widest = 0
  let tallest = 0
  for (const page of considered) {
    widest = Math.max(widest, page.width)
    tallest = Math.max(tallest, page.height)
  }
  if (widest <= 0 || tallest <= 0) return 1

  const columns = layout === 'two-page' ? 2 : 1
  const availableWidth = viewport.width - VIEW_PADDING * 2 - PAGE_GAP * (columns - 1)
  const availableHeight = viewport.height - VIEW_PADDING * 2
  const byWidth = availableWidth / (widest * columns * CSS_PX_PER_PT)
  if (mode === 'fit-width') return clampZoom(byWidth)
  return clampZoom(Math.min(byWidth, availableHeight / (tallest * CSS_PX_PER_PT)))
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

/** Reads "150", "150%" or "150 %". Returns `null` for anything else. */
export function parseZoom(text: string): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(text)
  if (!match) return null
  const percent = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(percent) || percent <= 0) return null
  return clampZoom(percent / 100)
}
