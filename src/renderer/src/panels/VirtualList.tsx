import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'cn'

interface VirtualListProps<T> {
  items: readonly T[]
  /** Height of an item in CSS pixels. Must not depend on anything but its arguments. */
  itemHeight: (item: T, index: number) => number
  itemKey: (item: T, index: number) => string | number
  children: (item: T, index: number) => React.ReactNode
  /** The item to keep in view; the list scrolls when it changes. */
  revealIndex?: number | null
  /** Extra pixels rendered above and below the visible part. */
  overscan?: number
  className?: string
  'aria-label'?: string
}

/** First index whose end lies beyond `y`. */
function indexAt(offsets: readonly number[], y: number): number {
  let low = 0
  let high = offsets.length - 2
  while (low < high) {
    const middle = (low + high) >> 1
    if (offsets[middle + 1] > y) high = middle
    else low = middle + 1
  }
  return Math.max(low, 0)
}

/**
 * A scrolling list that only mounts the items in view. Item heights are
 * known up front, so the scrollbar is right from the start.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  itemKey,
  children,
  revealIndex = null,
  overscan = 300,
  className,
  'aria-label': ariaLabel
}: VirtualListProps<T>): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)

  /** `offsets[i]` is where item i starts; the last entry is the total height. */
  const offsets = useMemo(() => {
    const result = new Array<number>(items.length + 1)
    result[0] = 0
    items.forEach((item, index) => {
      result[index + 1] = result[index] + itemHeight(item, index)
    })
    return result
  }, [items, itemHeight])
  const total = offsets[items.length]

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const observer = new ResizeObserver(() => setHeight(scroller.clientHeight))
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || revealIndex === null || revealIndex < 0 || revealIndex >= items.length) return
    const top = offsets[revealIndex]
    const bottom = offsets[revealIndex + 1]
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight
    }
    // Only a change of the item to reveal should scroll the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealIndex])

  let first = 0
  let last = -1
  if (items.length > 0 && height > 0) {
    first = indexAt(offsets, Math.max(scrollTop - overscan, 0))
    last = indexAt(offsets, Math.min(scrollTop + height + overscan, Math.max(total - 1, 0)))
  }

  const rendered: React.ReactNode[] = []
  for (let index = first; index <= last; index += 1) {
    const item = items[index]
    rendered.push(
      <div
        key={itemKey(item, index)}
        className="absolute inset-x-0"
        style={{ top: offsets[index], height: offsets[index + 1] - offsets[index] }}
      >
        {children(item, index)}
      </div>
    )
  }

  return (
    <div
      ref={scrollerRef}
      className={cn('min-h-0 flex-1 overflow-x-hidden overflow-y-auto', className)}
      aria-label={ariaLabel}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: total }}>
        {rendered}
      </div>
    </div>
  )
}
