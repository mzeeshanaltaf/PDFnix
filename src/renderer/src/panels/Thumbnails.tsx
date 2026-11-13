import { memo, useCallback, useState } from 'react'
import { cn } from 'cn'
import { Maximize2, Shuffle } from 'lucide-react'
import type { PageInfo } from '@/api/engine'
import { showToolDialog } from '@/state/dialogs'
import type { DocumentTab } from '@/state/tabs'
import { getViewer } from '@/viewer/controller'
import { useDevicePixelRatio, usePageImage } from '@/viewer/hooks'
import { IMAGE_PRIORITY } from '@/viewer/pageImages'
import { PageOrganiser } from './PageOrganiser'
import { VirtualList } from './VirtualList'

/** The box a thumbnail is fitted into, in CSS pixels. */
const MAX_WIDTH = 132
const MAX_HEIGHT = 190
/** Space for the page number under the thumbnail, and around the item. */
const LABEL_HEIGHT = 22
const ITEM_PADDING = 10

function thumbnailSize(page: PageInfo): { width: number; height: number } {
  const fit = Math.min(MAX_WIDTH / page.width, MAX_HEIGHT / page.height)
  return { width: Math.round(page.width * fit), height: Math.round(page.height * fit) }
}

function itemHeight(page: PageInfo): number {
  return thumbnailSize(page).height + LABEL_HEIGHT + ITEM_PADDING * 2
}

function pageKey(_page: PageInfo, index: number): number {
  return index
}

interface ThumbnailProps {
  tabId: string
  docId: string
  index: number
  page: PageInfo
  revision: number
  current: boolean
}

const Thumbnail = memo(function Thumbnail({
  tabId,
  docId,
  index,
  page,
  revision,
  current
}: ThumbnailProps): React.JSX.Element {
  const devicePixelRatio = useDevicePixelRatio()
  const size = thumbnailSize(page)
  // Image pixels per point, for one image pixel per device pixel.
  const scale = Math.round(((size.width * devicePixelRatio) / page.width) * 1000) / 1000
  const { image } = usePageImage(docId, index, revision, scale, IMAGE_PRIORITY.thumbnail)

  return (
    <button
      type="button"
      aria-label={`Page ${index + 1}`}
      aria-current={current ? 'page' : undefined}
      onClick={() => getViewer(tabId)?.goToPage(index)}
      className="group flex size-full flex-col items-center justify-center gap-1 outline-none"
    >
      <span
        className={cn(
          'block overflow-hidden rounded-xs bg-white shadow-sm ring-1 ring-black/10 transition-shadow',
          'group-hover:ring-2 group-hover:ring-primary/50 group-focus-visible:ring-2 group-focus-visible:ring-ring',
          current && 'ring-2 ring-primary group-hover:ring-primary'
        )}
        style={{ width: size.width, height: size.height }}
      >
        {image && <img src={image.url} alt="" draggable={false} className="size-full" />}
      </span>
      <span
        className={cn(
          'rounded-sm px-1.5 text-[11px] leading-[18px] tabular-nums',
          current ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
        )}
      >
        {index + 1}
      </span>
    </button>
  )
})

/**
 * The Pages panel: thumbnails to jump with, or, in Organise mode, the page
 * organiser (select, drag to reorder, delete, context menu). The full-window
 * organiser opens from here too.
 */
export function ThumbnailsPanel({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const [organising, setOrganising] = useState(false)
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <button
          type="button"
          aria-pressed={organising}
          onClick={() => setOrganising((on) => !on)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs',
            organising ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
          )}
          title="Select, reorder and delete pages here"
        >
          <Shuffle className="size-3.5" aria-hidden />
          Organise
        </button>
        <button
          type="button"
          onClick={() => showToolDialog('organiseTabId', tab.id)}
          className="ml-auto flex size-7 items-center justify-center rounded-md hover:bg-accent"
          title="Organise pages in a full window (Ctrl+Shift+O)"
          aria-label="Organise pages in a full window"
        >
          <Maximize2 className="size-3.5" aria-hidden />
        </button>
      </div>
      {organising ? (
        <PageOrganiser
          tab={tab}
          layout="list"
          onOpenPage={(index) => getViewer(tab.id)?.goToPage(index)}
        />
      ) : (
        <Thumbnails tab={tab} />
      )}
    </>
  )
}

/** Small images of every page. The current page is marked; a click jumps to a page. */
export function Thumbnails({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const { id, docId, pageRevisions, revision, page: currentPage } = tab

  const renderItem = useCallback(
    (page: PageInfo, index: number) => (
      <Thumbnail
        tabId={id}
        docId={docId}
        index={index}
        page={page}
        revision={pageRevisions[index] ?? revision}
        current={index === currentPage}
      />
    ),
    [id, docId, pageRevisions, revision, currentPage]
  )

  return (
    <VirtualList
      items={tab.pages}
      itemHeight={itemHeight}
      itemKey={pageKey}
      revealIndex={currentPage}
      aria-label="Page thumbnails"
    >
      {renderItem}
    </VirtualList>
  )
}
