import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import {
  ArrowDownToLine,
  Copy,
  FilePlus2,
  FileOutput,
  RotateCcw,
  RotateCw,
  SquarePlus,
  Trash2
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import type { PageInfo } from '@/api/engine'
import { insertFromFile, movePages } from '@/state/pageOps'
import { getTab, type DocumentTab } from '@/state/tabs'
import { useDevicePixelRatio, usePageImage } from '@/viewer/hooks'
import { IMAGE_PRIORITY } from '@/viewer/pageImages'
import { organiserActions } from './organiserActions'
import {
  clampSelection,
  clickSelect,
  EMPTY_SELECTION,
  gapAt,
  movedIndexes,
  moveOrder,
  nudgeOrder,
  selectAll,
  type PageSelection
} from './organiser'

/** Drag data type of pages being moved inside the organiser. */
const PAGES_TYPE = 'application/x-pdfnix-pages'
const LABEL_HEIGHT = 22
const PADDING = 8

export type OrganiserLayout = 'list' | 'grid'

interface Cell {
  width: number
  height: number
}

function cellFor(layout: OrganiserLayout, width: number): Cell {
  if (layout === 'list') {
    const cellWidth = Math.max(width, 120)
    return {
      width: cellWidth,
      height: Math.round(Math.min(cellWidth - 40, 160) * 1.35) + LABEL_HEIGHT
    }
  }
  return { width: 172, height: 230 }
}

function fit(page: PageInfo, box: Cell): { width: number; height: number } {
  const maxWidth = box.width - PADDING * 2 - 8
  const maxHeight = box.height - LABEL_HEIGHT - PADDING * 2
  const scale = Math.min(maxWidth / page.width, maxHeight / page.height)
  return { width: Math.round(page.width * scale), height: Math.round(page.height * scale) }
}

interface ThumbProps {
  docId: string
  index: number
  page: PageInfo
  revision: number
  cell: Cell
  selected: boolean
  current: boolean
}

const Thumb = memo(function Thumb({
  docId,
  index,
  page,
  revision,
  cell,
  selected,
  current
}: ThumbProps): React.JSX.Element {
  const devicePixelRatio = useDevicePixelRatio()
  const size = fit(page, cell)
  const scale = Math.round(((size.width * devicePixelRatio) / page.width) * 1000) / 1000
  const { image } = usePageImage(docId, index, revision, scale, IMAGE_PRIORITY.thumbnail)
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1 select-none">
      <span
        className={cn(
          'block overflow-hidden rounded-xs bg-white shadow-sm ring-1 ring-black/10',
          selected && 'ring-[3px] ring-primary',
          !selected && current && 'ring-2 ring-primary/50'
        )}
        style={{ width: size.width, height: size.height }}
      >
        {image && <img src={image.url} alt="" draggable={false} className="size-full" />}
      </span>
      <span
        className={cn(
          'rounded-sm px-1.5 text-[11px] leading-[18px] tabular-nums',
          selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
        )}
      >
        {index + 1}
        {page.rotation !== 0 && <span className="ml-1 opacity-70">{page.rotation}°</span>}
      </span>
    </div>
  )
})

interface OrganiserProps {
  tab: DocumentTab
  layout: OrganiserLayout
  /** Called when a page is opened (double-click or Enter). */
  onOpenPage?: (index: number) => void
  /** Selection, so a surrounding toolbar can act on it. */
  onSelectionChange?: (pages: number[]) => void
  /** Changing it clears the selection (after a toolbar action). */
  resetToken?: number
  className?: string
}

/**
 * Pages as thumbnails to select (click, Ctrl, Shift), drag into a new order,
 * delete (Delete key), and act on from the context menu. Dropping a PDF file
 * between pages inserts it there.
 */
export function PageOrganiser({
  tab,
  layout,
  onOpenPage,
  onSelectionChange,
  resetToken,
  className
}: OrganiserProps): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const [selection, setSelection] = useState<PageSelection>(EMPTY_SELECTION)
  const [gap, setGap] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState(tab.page)
  const draggingRef = useRef<number[] | null>(null)

  const pageCount = tab.pageCount
  const current = clampSelection(selection, pageCount)
  const selected = current.pages

  useEffect(() => {
    onSelectionChange?.(selected)
    // Only when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join(',')])

  // A new token clears the selection (adjusted while rendering, not in an effect).
  const [seenToken, setSeenToken] = useState(resetToken)
  if (resetToken !== seenToken) {
    setSeenToken(resetToken)
    setSelection(EMPTY_SELECTION)
  }

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // Measured now, too: a ResizeObserver does not fire while the window gets no frames.
    setSize({ width: scroller.clientWidth, height: scroller.clientHeight })
    const observer = new ResizeObserver(() =>
      setSize({ width: scroller.clientWidth, height: scroller.clientHeight })
    )
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  const cell = cellFor(layout, size.width)
  const columns = layout === 'list' ? 1 : Math.max(1, Math.floor(size.width / cell.width))
  const rows = Math.ceil(pageCount / columns)
  const left0 = layout === 'list' ? 0 : Math.max(0, (size.width - columns * cell.width) / 2)
  const position = useCallback(
    (index: number) => ({
      left: left0 + (index % columns) * cell.width,
      top: Math.floor(index / columns) * cell.height
    }),
    [left0, columns, cell.width, cell.height]
  )

  // Keep the focused page in view.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || size.height === 0) return
    const { top } = position(focusIndex)
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (top + cell.height > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top + cell.height - scroller.clientHeight
    }
  }, [focusIndex, position, cell.height, size.height])

  const firstRow = Math.max(0, Math.floor(scrollTop / cell.height) - 1)
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + size.height) / cell.height) + 1)

  const resetSelection = (): void => setSelection(EMPTY_SELECTION)
  const actions = organiserActions(tab, selected, resetSelection)

  const select = (index: number, event: { ctrlKey: boolean; shiftKey: boolean }): void => {
    setSelection((previous) =>
      clickSelect(clampSelection(previous, pageCount), index, {
        toggle: event.ctrlKey,
        range: event.shiftKey
      })
    )
    setFocusIndex(index)
  }

  const move = async (moving: number[], to: number): Promise<void> => {
    const order = moveOrder(pageCount, moving, to)
    if (!order) return
    const landed = movedIndexes(pageCount, moving, to)
    if (await movePages(tab.id, order)) {
      setSelection({ pages: landed, anchor: landed[0] })
      setFocusIndex(landed[0])
    }
  }

  /** The gap under the pointer, from the cell it is over. */
  const gapFromEvent = (event: React.DragEvent): number | null => {
    const scroller = scrollerRef.current
    if (!scroller) return null
    const bounds = scroller.getBoundingClientRect()
    const x = event.clientX - bounds.left - left0
    const y = event.clientY - bounds.top + scroller.scrollTop
    const row = Math.max(0, Math.min(rows - 1, Math.floor(y / cell.height)))
    const column = Math.max(0, Math.min(columns - 1, Math.floor(x / cell.width)))
    const index = row * columns + column
    if (index >= pageCount) return pageCount
    const firstHalf =
      layout === 'list'
        ? y - row * cell.height < cell.height / 2
        : x - column * cell.width < cell.width / 2
    return gapAt(index, firstHalf)
  }

  const isFiles = (event: React.DragEvent): boolean => event.dataTransfer.types.includes('Files')
  const isPages = (event: React.DragEvent): boolean => event.dataTransfer.types.includes(PAGES_TYPE)

  // Events bubble on to the window, whose file-drop handler leaves the
  // organiser's drops alone (App.tsx).
  const onDragOver = (event: React.DragEvent): void => {
    if (!isFiles(event) && !isPages(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = isFiles(event) ? 'copy' : 'move'
    const next = gapFromEvent(event)
    setGap((previous) => (previous === next ? previous : next))
  }

  const onDrop = (event: React.DragEvent): void => {
    if (!isFiles(event) && !isPages(event)) return
    event.preventDefault()
    const at = gapFromEvent(event)
    setGap(null)
    if (at === null) return
    if (isPages(event)) {
      const moving = draggingRef.current ?? []
      draggingRef.current = null
      void move(moving, at)
      return
    }
    const pdfs = Array.from(event.dataTransfer.files)
      .map((file) => window.api.files.pathForFile(file))
      .filter((path) => /\.pdf$/i.test(path))
    void (async () => {
      // Each file goes after the previous one.
      let position = at
      for (const path of pdfs) {
        const before = tab.pageCount
        if (await insertFromFile(tab.id, position, path)) {
          position += Math.max(0, (getTabPageCount(tab.id) ?? before) - before)
        }
      }
    })()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const key = event.key
    const handled = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    if ((key === 'Delete' || key === 'Backspace') && selected.length > 0) {
      handled()
      actions.remove()
    } else if (key === 'a' && event.ctrlKey) {
      handled()
      setSelection(selectAll(pageCount))
    } else if (key === 'Escape' && selected.length > 0) {
      handled()
      resetSelection()
    } else if (key === 'Enter' && onOpenPage) {
      handled()
      onOpenPage(focusIndex)
    } else if (
      (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') &&
      event.ctrlKey &&
      selected.length > 0
    ) {
      // Ctrl+arrows move the selected pages.
      handled()
      const delta = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1
      const step = layout === 'grid' && (key === 'ArrowUp' || key === 'ArrowDown') ? columns : 1
      let nudge = nudgeOrder(pageCount, selected, delta)
      if (step > 1 && nudge) {
        const target = delta < 0 ? selected[0] - step : selected[selected.length - 1] + step + 1
        const order = moveOrder(pageCount, selected, Math.max(0, Math.min(pageCount, target)))
        nudge = order
          ? {
              order,
              moved: movedIndexes(pageCount, selected, Math.max(0, Math.min(pageCount, target)))
            }
          : null
      }
      if (nudge) {
        const { order, moved } = nudge
        void movePages(tab.id, order).then((ok) => {
          if (ok) {
            setSelection({ pages: moved, anchor: moved[0] })
            setFocusIndex(moved[0])
          }
        })
      }
    } else if (
      key === 'ArrowUp' ||
      key === 'ArrowDown' ||
      key === 'ArrowLeft' ||
      key === 'ArrowRight'
    ) {
      handled()
      const step =
        key === 'ArrowLeft' || (key === 'ArrowUp' && layout === 'list')
          ? -1
          : key === 'ArrowRight' || (key === 'ArrowDown' && layout === 'list')
            ? 1
            : key === 'ArrowUp'
              ? -columns
              : columns
      const next = Math.max(0, Math.min(pageCount - 1, focusIndex + step))
      setFocusIndex(next)
      setSelection((previous) =>
        clickSelect(clampSelection(previous, pageCount), next, { range: event.shiftKey })
      )
    }
  }

  const cells: React.ReactNode[] = []
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column
      if (index >= pageCount) break
      const { left, top } = position(index)
      const isSelected = selected.includes(index)
      cells.push(
        <div
          key={index}
          role="option"
          aria-selected={isSelected}
          aria-label={`Page ${index + 1}`}
          data-page-index={index}
          draggable
          className={cn(
            'absolute rounded-md p-2',
            focusIndex === index && 'outline-1 outline-offset-[-3px] outline-ring/60',
            isSelected && 'bg-primary/8'
          )}
          style={{ left, top, width: cell.width, height: cell.height }}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            // A press on an already selected page keeps the selection, so it can be dragged.
            if (isSelected && !event.ctrlKey && !event.shiftKey) {
              setFocusIndex(index)
              return
            }
            select(index, event)
          }}
          onClick={(event) => {
            if (isSelected && !event.ctrlKey && !event.shiftKey && selected.length > 1) {
              setSelection({ pages: [index], anchor: index })
            }
          }}
          onDoubleClick={() => onOpenPage?.(index)}
          onContextMenu={() => {
            if (!isSelected) setSelection({ pages: [index], anchor: index })
            setFocusIndex(index)
          }}
          onDragStart={(event) => {
            const moving = isSelected ? selected : [index]
            if (!isSelected) setSelection({ pages: [index], anchor: index })
            draggingRef.current = moving
            event.dataTransfer.setData(PAGES_TYPE, moving.join(','))
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            draggingRef.current = null
            setGap(null)
          }}
        >
          <Thumb
            docId={tab.docId}
            index={index}
            page={tab.pages[index]}
            revision={tab.pageRevisions[index] ?? tab.revision}
            cell={cell}
            selected={isSelected}
            current={index === tab.page}
          />
        </div>
      )
    }
  }

  let marker: React.ReactNode = null
  if (gap !== null) {
    const index = Math.min(gap, pageCount - 1)
    const { left, top } = position(index)
    const atEnd = gap === pageCount
    marker =
      layout === 'list' ? (
        <div
          className="pdf-organiser-gap"
          style={{ left: 12, right: 12, top: (atEnd ? top + cell.height : top) - 2, height: 4 }}
        />
      ) : (
        <div
          className="pdf-organiser-gap"
          style={{
            left: (atEnd ? left + cell.width : left) - 2,
            top: top + 8,
            width: 4,
            height: cell.height - 16
          }}
        />
      )
  }

  const count = selected.length
  const label = count > 1 ? `${count} pages` : 'page'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={scrollerRef}
          data-page-organiser
          tabIndex={0}
          role="listbox"
          aria-multiselectable
          aria-label="Pages"
          className={cn(
            'relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none',
            className
          )}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onKeyDown={onKeyDown}
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGap(null)
          }}
          onDrop={onDrop}
          onMouseDown={(event) => {
            // A press on empty space clears the selection.
            if (
              event.target === event.currentTarget ||
              event.target === event.currentTarget.firstChild
            ) {
              resetSelection()
            }
          }}
        >
          <div className="relative" style={{ height: rows * cell.height + PADDING }}>
            {cells}
            {marker}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem disabled={count === 0} onSelect={() => actions.rotate(90)}>
          <RotateCw /> Rotate {label} clockwise
        </ContextMenuItem>
        <ContextMenuItem disabled={count === 0} onSelect={() => actions.rotate(-90)}>
          <RotateCcw /> Rotate {label} counterclockwise
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={count === 0} onSelect={actions.duplicate}>
          <Copy /> Duplicate {label}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={count === 0 || count >= pageCount}
          variant="destructive"
          onSelect={actions.remove}
        >
          <Trash2 /> Delete {label}
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={count === 0} onSelect={actions.extract}>
          <FileOutput /> Extract {label}…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.insertBlank('before')}>
          <SquarePlus /> Insert blank page before
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.insertBlank('after')}>
          <ArrowDownToLine /> Insert blank page after
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.insertFile('after')}>
          <FilePlus2 /> Insert pages from file…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function getTabPageCount(tabId: string): number | null {
  return getTab(tabId)?.pageCount ?? null
}
