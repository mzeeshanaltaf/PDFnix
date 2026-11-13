/**
 * How the rest of the app steers the viewer. The mounted viewer (there is one
 * at a time, for the active tab) registers a handle; toolbar buttons, menu
 * commands, keyboard shortcuts and the side panels call it through here.
 */

import type { Rect } from '@/api/engine'
import type { ZoomMode } from './zoom'

export interface ViewerHandle {
  /** The tab this viewer shows. */
  tabId: string
  /** Scrolls so the top of the page (0-based) is at the top of the view. */
  goToPage(page: number): void
  /** Sets the zoom, keeping the middle of the view where it is. */
  zoomTo(zoom: number): void
  /** One step in (`1`) or out (`-1`). */
  zoomStep(direction: 1 | -1): void
  /** Fits the pages to the window, or returns to a fixed zoom. */
  setZoomMode(mode: ZoomMode): void
  /** Brings a rectangle on a page (in points) into view if it is not already. */
  reveal(page: number, rect: Rect): void
  /** Scrolls by a number of viewport heights (0.9 is "one page down"). */
  scrollByViewport(fraction: number): void
  scrollByPixels(x: number, y: number): void
  /**
   * Call just before changing the pages (rotation): the view then stays at
   * the top of the given page instead of at a point that no longer exists.
   */
  holdPage(page: number): void
}

let current: ViewerHandle | null = null

export function registerViewer(handle: ViewerHandle): () => void {
  current = handle
  return () => {
    if (current === handle) current = null
  }
}

/** The handle of the mounted viewer, or `null` when no document is shown. */
export function getViewer(tabId?: string): ViewerHandle | null {
  if (tabId !== undefined && current?.tabId !== tabId) return null
  return current
}
