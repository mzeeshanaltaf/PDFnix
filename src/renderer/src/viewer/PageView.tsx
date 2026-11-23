import { memo, useState } from 'react'
import { cn } from 'cn'
import type { PageInfo, SearchHit } from '@/api/engine'
import { AnnotationLayer } from './AnnotationLayer'
import { CodeLayer } from './CodeLayer'
import { EditLayer } from './EditLayer'
import { FormLayer } from './FormLayer'
import { cssScale, quadBounds, rectToPx, renderScale } from './geometry'
import { usePageImage } from './hooks'
import type { PageBox } from './layout'
import { LinkLayer } from './LinkLayer'
import { TextLayer } from './TextLayer'

interface PageViewProps {
  tabId: string
  docId: string
  page: PageInfo
  /** Where the page sits in the list, in CSS pixels. */
  box: PageBox
  /** The revision that last changed this page. */
  revision: number
  /** The zoom the page is laid out at. */
  zoom: number
  /** The zoom to render the image at: `zoom` once it has stopped changing. */
  imageZoom: number
  devicePixelRatio: number
  /** How urgently the image is wanted; see `IMAGE_PRIORITY`. */
  priority: number
  /** Search hits on this page, if any. */
  hits?: readonly SearchHit[]
  activeHit?: SearchHit | null
  /** The selected annotation, if it is on this page. */
  selectedAnnotId: number | null
}

/**
 * One page: the image rendered by the engine, the search highlights, the
 * selectable text and the annotation layer on top. Later phases add the form
 * and edit layers here.
 */
export const PageView = memo(function PageView({
  tabId,
  docId,
  page,
  box,
  revision,
  zoom,
  imageZoom,
  devicePixelRatio,
  priority,
  hits,
  activeHit,
  selectedAnnotId
}: PageViewProps): React.JSX.Element {
  const wanted = renderScale(imageZoom, devicePixelRatio, page)
  const { image, failed, retry } = usePageImage(docId, box.index, revision, wanted, priority)
  const [natural, setNatural] = useState<{ url: string; width: number; height: number } | null>(
    null
  )

  // An image rendered for exactly this zoom is shown pixel for pixel, which
  // keeps text crisp. Any other image is stretched to the page for now.
  const exact =
    image !== null &&
    natural !== null &&
    natural.url === image.url &&
    image.scale === renderScale(zoom, devicePixelRatio, page)
  const imageStyle = exact
    ? {
        width: `${natural.width / devicePixelRatio}px`,
        height: `${natural.height / devicePixelRatio}px`
      }
    : { width: '100%', height: '100%' }

  return (
    <div
      className="pdf-page"
      data-page-index={box.index}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      {image && (
        <img
          src={image.url}
          alt=""
          draggable={false}
          style={imageStyle}
          onLoad={(event) =>
            setNatural({
              url: image.url,
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            })
          }
        />
      )}
      {failed && !image && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] text-neutral-600">
          <span>This page could not be displayed.</span>
          <button
            type="button"
            onClick={retry}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-neutral-800 hover:bg-neutral-100"
          >
            Try again
          </button>
        </div>
      )}
      {hits && hits.length > 0 && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {hits.map((hit, hitIndex) =>
            hit.quads.map((quad, quadIndex) => (
              <div
                key={`${hitIndex}-${quadIndex}`}
                className={cn('pdf-search-hit', hit === activeHit && 'active')}
                style={rectToPx(quadBounds(quad), zoom)}
              />
            ))
          )}
        </div>
      )}
      <TextLayer
        docId={docId}
        page={box.index}
        revision={revision}
        width={page.width}
        height={page.height}
        scale={cssScale(zoom)}
      />
      <LinkLayer tabId={tabId} docId={docId} page={box.index} revision={revision} zoom={zoom} />
      <CodeLayer tabId={tabId} page={box.index} revision={revision} zoom={zoom} />
      <AnnotationLayer
        tabId={tabId}
        docId={docId}
        page={box.index}
        revision={revision}
        zoom={zoom}
        width={page.width}
        height={page.height}
        selectedId={selectedAnnotId}
      />
      <FormLayer tabId={tabId} page={box.index} zoom={zoom} />
      <EditLayer
        tabId={tabId}
        docId={docId}
        page={box.index}
        revision={revision}
        zoom={zoom}
        width={page.width}
        height={page.height}
      />
    </div>
  )
})
