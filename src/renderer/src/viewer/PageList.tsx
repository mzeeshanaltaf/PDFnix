import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'cn'
import type { Rect, SearchHit } from '@/api/engine'
import { getTab, useTabs, type DocumentTab } from '@/state/tabs'
import { useTools } from '@/state/tools'
import { registerViewer, type ViewerHandle } from './controller'
import type { Point, Size } from './geometry'
import { useDevicePixelRatio, useSettled } from './hooks'
import {
  anchorAt,
  anchorPosition,
  buildLayout,
  currentPageAt,
  layoutOffset,
  VIEW_PADDING,
  visibleRows,
  type Anchor,
  type DocumentLayout
} from './layout'
import { IMAGE_PRIORITY } from './pageImages'
import { PageView } from './PageView'
import { openSelectionMenuAt } from '@/tools/selectionMenuState'
import { installSelectionHandling, selectedWordPieces } from './selection'
import { recallViewPosition, rememberViewPosition } from './viewPositions'
import { clampZoom, fitZoom, stepZoom, wheelZoom, type ZoomMode } from './zoom'

/**
 * Right-click with page text selected opens the selection menu at the
 * pointer. Anywhere else (no selection, or a text box or other input) the
 * press is left alone.
 */
function openMenuOnSelection(event: React.MouseEvent): void {
  const target = event.target
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return
  }
  if (selectedWordPieces(document.getSelection()).length === 0) return
  event.preventDefault()
  openSelectionMenuAt(event.clientX, event.clientY)
}

/** Pages this far outside the viewport are mounted too, so they are ready. */
const OVERSCAN_PX = 800
/** The sharp image is requested once the zoom has been still for this long. */
const ZOOM_SETTLE_MS = 160
/** In single-page layout, the wheel turns at most one page per this interval. */
const PAGE_TURN_MS = 300
/** A search hit closer than this to the edge of the view is scrolled into it. */
const REVEAL_MARGIN = 32

/** A position to scroll to: put `anchor` at the viewport point `at`. */
interface Placement {
  anchor: Anchor
  at: Point
  /** Use the horizontal middle of the page instead of `anchor.x`. */
  centred?: boolean
}

interface Latest {
  tab: DocumentTab
  layout: DocumentLayout
  viewport: Size
  zoom: number
}

interface Range {
  /** Rows to mount, including the overscan. */
  first: number
  last: number
  /** Rows actually in view. */
  visibleFirst: number
  visibleLast: number
}

function place(
  scroller: HTMLElement,
  layout: DocumentLayout,
  viewport: Size,
  placement: Placement
): void {
  const box = layout.byIndex.get(placement.anchor.page)
  const anchor =
    placement.centred && box
      ? { ...placement.anchor, x: box.width / layout.scale / 2 }
      : placement.anchor
  const position = anchorPosition(layout, anchor) ?? { x: layout.width / 2, y: 0 }
  const offset = layoutOffset(layout, viewport)
  scroller.scrollLeft = position.x + offset.x - placement.at.x
  scroller.scrollTop = position.y + offset.y - placement.at.y
}

/**
 * The scrolling list of pages for one tab. Only the pages near the viewport
 * are mounted. Also owns everything that moves the view: scrolling, zooming
 * around a point, page turns and jumping to search hits.
 */
export function PageList({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const [range, setRange] = useState<Range | null>(null)
  const devicePixelRatio = useDevicePixelRatio()

  const measured = viewport.width > 0 && viewport.height > 0
  const zoom =
    tab.zoomMode === 'custom' || !measured
      ? tab.zoom
      : fitZoom(tab.zoomMode, viewport, tab.pages, tab.layout, tab.page)
  const imageZoom = useSettled(zoom, ZOOM_SETTLE_MS)
  const shownPage = tab.layout === 'single' ? tab.page : 0
  const layout = useMemo(
    () => buildLayout(tab.pages, tab.layout, zoom, shownPage),
    [tab.pages, tab.layout, zoom, shownPage]
  )
  const offset = layoutOffset(layout, viewport)

  /** What the event handlers work with: the values of the latest render. */
  const latest = useRef<Latest | null>(null)
  /** A position to take up once the next layout is in the DOM. */
  const pending = useRef<Placement | null>(null)
  /** The zoom asked for but not rendered yet (several wheel events per frame). */
  const targetZoom = useRef<number | null>(null)
  /** A page jumped to explicitly stays "current" until the view is scrolled. */
  const pinned = useRef<{ page: number; scrollTop: number } | null>(null)
  const applied = useRef<{ layout: DocumentLayout; viewport: Size } | null>(null)
  const lastTurn = useRef(0)

  /** Works out from the scroll position what to mount and what page we are on. */
  const sync = (): void => {
    const scroller = scrollerRef.current
    const now = latest.current
    if (!scroller || !now) return
    const shift = layoutOffset(now.layout, now.viewport)
    const top = scroller.scrollTop - shift.y
    const bottom = top + now.viewport.height

    const mounted = visibleRows(now.layout, top, bottom, OVERSCAN_PX)
    const inView = visibleRows(now.layout, top, bottom)
    setRange((previous) => {
      if (!mounted || !inView) return null
      if (
        previous &&
        previous.first === mounted.first &&
        previous.last === mounted.last &&
        previous.visibleFirst === inView.first &&
        previous.visibleLast === inView.last
      ) {
        return previous
      }
      return {
        first: mounted.first,
        last: mounted.last,
        visibleFirst: inView.first,
        visibleLast: inView.last
      }
    })

    if (pinned.current && Math.abs(pinned.current.scrollTop - scroller.scrollTop) > 1) {
      pinned.current = null
    }
    if (now.layout.mode !== 'single') {
      const page = pinned.current?.page ?? currentPageAt(now.layout, top, bottom)
      useTabs.getState().setPage(now.tab.id, page)
    }

    const anchor = anchorAt(now.layout, scroller.scrollLeft - shift.x + now.viewport.width / 2, top)
    if (anchor) rememberViewPosition(now.tab.id, anchor)
  }

  // After every render: take up the position that was asked for, or, if the
  // layout changed for another reason, stay at the same place in the document.
  // This runs before the browser paints, so the view never jumps.
  useLayoutEffect(() => {
    latest.current = { tab, layout, viewport, zoom }
    targetZoom.current = null
    const scroller = scrollerRef.current
    if (!scroller || !measured) return

    const placement = pending.current
    pending.current = null
    const previous = applied.current
    if (placement) {
      place(scroller, layout, viewport, placement)
    } else if (
      !previous ||
      previous.layout !== layout ||
      previous.viewport.width !== viewport.width
    ) {
      const saved = recallViewPosition(tab.id)
      place(
        scroller,
        layout,
        viewport,
        saved
          ? { anchor: saved, at: { x: viewport.width / 2, y: 0 } }
          : {
              anchor: { page: tab.page, x: 0, y: 0 },
              at: { x: viewport.width / 2, y: VIEW_PADDING },
              centred: true
            }
      )
    }
    applied.current = { layout, viewport }
    sync()
  })

  // In a fit mode the zoom is worked out here; the tab records the result so
  // the toolbar can show it.
  useEffect(() => {
    if (measured && tab.zoomMode !== 'custom' && Math.abs(tab.zoom - zoom) > 1e-6) {
      useTabs.getState().setZoom(tab.id, zoom)
    }
  }, [measured, tab.id, tab.zoom, tab.zoomMode, zoom])

  // Track the size of the view. It is measured once straight away: a
  // ResizeObserver only reports on a rendering frame, and a window in the
  // background may not get one for a long time.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const measure = (): void => {
      const next = { width: scroller.clientWidth, height: scroller.clientHeight }
      setViewport((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  useEffect(() => installSelectionHandling(), [])

  // The handle the rest of the app steers this viewer with, and the wheel.
  const tabId = tab.id
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    /** Scrolls to a placement in the layout that is already on screen. */
    const moveTo = (placement: Placement): void => {
      const now = latest.current
      if (!now) return
      place(scroller, now.layout, now.viewport, placement)
      sync()
    }

    const zoomAround = (target: number, at?: Point): void => {
      const now = latest.current
      const current = getTab(tabId)
      if (!now || !current) return
      const next = clampZoom(target)
      if (next === (targetZoom.current ?? now.zoom) && current.zoomMode === 'custom') return

      const point = at ?? { x: now.viewport.width / 2, y: now.viewport.height / 2 }
      const shift = layoutOffset(now.layout, now.viewport)
      const anchor = anchorAt(
        now.layout,
        scroller.scrollLeft - shift.x + point.x,
        scroller.scrollTop - shift.y + point.y
      )
      if (anchor) pending.current = { anchor, at: point }
      targetZoom.current = next
      useTabs.getState().setZoom(tabId, next, 'custom')
    }

    const goToPage = (page: number, alignBottom = false): void => {
      const now = latest.current
      if (!now || now.tab.pageCount === 0) return
      const target = Math.min(Math.max(Math.trunc(page), 0), now.tab.pageCount - 1)
      const placement: Placement = alignBottom
        ? {
            anchor: { page: target, x: 0, y: now.tab.pages[target].height },
            at: { x: now.viewport.width / 2, y: now.viewport.height - VIEW_PADDING },
            centred: true
          }
        : {
            anchor: { page: target, x: 0, y: 0 },
            at: { x: now.viewport.width / 2, y: VIEW_PADDING },
            centred: true
          }
      if (now.layout.byIndex.has(target)) {
        moveTo(placement)
        pinned.current = { page: target, scrollTop: scroller.scrollTop }
        useTabs.getState().setPage(tabId, target)
      } else {
        // Single-page layout: the page has to be laid out first.
        pending.current = placement
        useTabs.getState().setPage(tabId, target)
      }
    }

    const handle: ViewerHandle = {
      tabId,
      goToPage: (page) => goToPage(page),
      zoomTo: (target) => zoomAround(target),
      zoomStep: (direction) => {
        const now = latest.current
        if (now) zoomAround(stepZoom(targetZoom.current ?? now.zoom, direction))
      },
      setZoomMode: (mode: ZoomMode) => {
        const now = latest.current
        const current = getTab(tabId)
        if (!now || !current || current.zoomMode === mode) return
        // Keep the top of the view where it is while the pages resize.
        const shift = layoutOffset(now.layout, now.viewport)
        const at = { x: now.viewport.width / 2, y: 0 }
        const anchor = anchorAt(
          now.layout,
          scroller.scrollLeft - shift.x + at.x,
          scroller.scrollTop - shift.y
        )
        if (anchor) pending.current = { anchor, at }
        useTabs.getState().setZoom(tabId, now.zoom, mode)
      },
      reveal: (page: number, rect: Rect) => {
        const now = latest.current
        if (!now) return
        const centre: Anchor = { page, x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 }
        const middle = { x: now.viewport.width / 2, y: now.viewport.height / 2 }
        const box = now.layout.byIndex.get(page)
        if (!box) {
          pending.current = { anchor: centre, at: middle }
          useTabs.getState().setPage(tabId, page)
          return
        }
        const shift = layoutOffset(now.layout, now.viewport)
        const { scale } = now.layout
        // The rectangle in viewport coordinates.
        const left = box.left + rect[0] * scale + shift.x - scroller.scrollLeft
        const right = box.left + rect[2] * scale + shift.x - scroller.scrollLeft
        const top = box.top + rect[1] * scale + shift.y - scroller.scrollTop
        const bottom = box.top + rect[3] * scale + shift.y - scroller.scrollTop
        const fitsAcross = left >= REVEAL_MARGIN && right <= now.viewport.width - REVEAL_MARGIN
        const fitsDown = top >= REVEAL_MARGIN && bottom <= now.viewport.height - REVEAL_MARGIN
        if (fitsAcross && fitsDown) return
        // Only move along the axis on which it is out of view.
        moveTo({
          anchor: centre,
          at: {
            x: fitsAcross ? (left + right) / 2 : middle.x,
            y: fitsDown ? (top + bottom) / 2 : middle.y
          }
        })
      },
      scrollByViewport: (fraction) => {
        const now = latest.current
        if (!now) return
        if (now.layout.mode === 'single') {
          const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
          if (fraction > 0 && atBottom) {
            if (now.tab.page < now.tab.pageCount - 1) goToPage(now.tab.page + 1)
            return
          }
          if (fraction < 0 && scroller.scrollTop <= 0) {
            if (now.tab.page > 0) goToPage(now.tab.page - 1, true)
            return
          }
        }
        scroller.scrollBy({ top: fraction * scroller.clientHeight })
      },
      scrollByPixels: (x, y) => scroller.scrollBy({ left: x, top: y }),
      holdPage: (page) => {
        const now = latest.current
        if (!now) return
        pending.current = {
          anchor: { page, x: 0, y: 0 },
          at: { x: now.viewport.width / 2, y: VIEW_PADDING },
          centred: true
        }
      }
    }
    const unregister = registerViewer(handle)

    const onWheel = (event: WheelEvent): void => {
      const now = latest.current
      if (!now) return
      const lineHeight = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : 1
      const delta = event.deltaY * lineHeight

      if (event.ctrlKey) {
        // Zoom, keeping the point under the cursor where it is.
        event.preventDefault()
        const bounds = scroller.getBoundingClientRect()
        zoomAround(wheelZoom(targetZoom.current ?? now.zoom, delta), {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top
        })
        return
      }

      if (now.layout.mode !== 'single' || delta === 0 || event.shiftKey) return
      // One page at a time: scrolling past the end of a page turns it.
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
      const atTop = scroller.scrollTop <= 0
      const forward = delta > 0 && atBottom && now.tab.page < now.tab.pageCount - 1
      const backward = delta < 0 && atTop && now.tab.page > 0
      if (!forward && !backward) return
      event.preventDefault()
      const time = performance.now()
      if (time - lastTurn.current < PAGE_TURN_MS) return
      lastTurn.current = time
      if (forward) goToPage(now.tab.page + 1)
      else goToPage(now.tab.page - 1, true)
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      unregister()
      scroller.removeEventListener('wheel', onWheel)
    }
    // `sync` only reads refs, so the handle never goes stale.
  }, [tabId])

  const hitsByPage = useMemo(() => {
    const map = new Map<number, SearchHit[]>()
    for (const hit of tab.search.hits) {
      const list = map.get(hit.page)
      if (list) list.push(hit)
      else map.set(hit.page, [hit])
    }
    return map
  }, [tab.search.hits])
  const activeHit = tab.search.hits[tab.search.activeIndex] ?? null
  const activeTool = useTools((state) => state.activeTool)

  const pages: React.JSX.Element[] = []
  if (range && measured) {
    const last = Math.min(range.last, layout.rows.length - 1)
    for (let rowIndex = Math.max(range.first, 0); rowIndex <= last; rowIndex += 1) {
      const inView = rowIndex >= range.visibleFirst && rowIndex <= range.visibleLast
      for (const box of layout.rows[rowIndex].boxes) {
        const pageHits = hitsByPage.get(box.index)
        pages.push(
          <PageView
            key={box.index}
            tabId={tab.id}
            docId={tab.docId}
            page={tab.pages[box.index]}
            box={box}
            revision={tab.pageRevisions[box.index] ?? tab.revision}
            zoom={zoom}
            imageZoom={imageZoom}
            devicePixelRatio={devicePixelRatio}
            priority={inView ? IMAGE_PRIORITY.visible : IMAGE_PRIORITY.nearby}
            hits={pageHits}
            activeHit={pageHits && activeHit?.page === box.index ? activeHit : null}
            selectedAnnotId={
              tab.selectedAnnotation?.page === box.index ? tab.selectedAnnotation.annotId : null
            }
          />
        )
      }
    }
  }

  return (
    <div
      ref={scrollerRef}
      className={cn('pdf-scroller', `tool-${activeTool}`)}
      // Reachable with Tab, so the keyboard can scroll the pages.
      tabIndex={0}
      role="region"
      aria-label={`Pages of ${tab.fileName}`}
      onScroll={sync}
      onContextMenu={openMenuOnSelection}
      data-tab-id={tab.id}
      data-zoom={zoom}
    >
      <div
        className="relative"
        style={{
          width: layout.width,
          height: layout.height,
          marginLeft: offset.x,
          marginTop: offset.y
        }}
      >
        {pages}
      </div>
    </div>
  )
}
