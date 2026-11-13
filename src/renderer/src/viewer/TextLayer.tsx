import { memo, useEffect, useRef } from 'react'
import type { PageText } from '@/api/engine'
import { usePageText } from './hooks'
import {
  END_OF_CONTENT_CLASS,
  END_OF_LINE_ATTRIBUTE,
  registerTextLayer,
  TEXT_LAYER_CLASS
} from './selection'
import { layoutLine } from './textLayout'

/** The layer's font. Only its metrics matter: the text itself is invisible. */
const FONT_FAMILY = 'sans-serif'
/** Font size relative to the height of the line box. */
const FONT_RATIO = 0.8
const MEASURE_SIZE = 100

let measureContext: CanvasRenderingContext2D | null = null
const measured = new Map<string, number>()

/** Natural width of `text` at a font size of 1, in the layer's font. */
function unitWidth(text: string): number {
  const known = measured.get(text)
  if (known !== undefined) return known
  if (!measureContext) {
    measureContext = document.createElement('canvas').getContext('2d')
    if (measureContext) measureContext.font = `${MEASURE_SIZE}px ${FONT_FAMILY}`
  }
  const width = measureContext ? measureContext.measureText(text).width / MEASURE_SIZE : 0
  if (measured.size > 50_000) measured.clear()
  measured.set(text, width)
  return width
}

/**
 * Fills `layer` with one transparent span per word, positioned in points
 * (the layer itself is scaled to the zoom). Returns the cleanup.
 */
function mount(layer: HTMLElement, text: PageText): () => void {
  const fragment = document.createDocumentFragment()
  for (const line of text.lines) {
    for (const span of layoutLine(line)) {
      const element = document.createElement('span')
      element.textContent = span.text
      const fontSize = span.thickness * FONT_RATIO
      const natural = unitWidth(span.text) * fontSize
      const stretch = natural > 0 ? span.length / natural : 1
      const turn = span.rotation === 0 ? '' : `rotate(${span.rotation}deg) `
      element.style.cssText =
        `left:${span.x}px;top:${span.y}px;height:${span.thickness}px;` +
        `line-height:${span.thickness}px;font-size:${fontSize}px;` +
        `transform:${turn}scaleX(${stretch})`
      if (span.endOfLine) element.setAttribute(END_OF_LINE_ATTRIBUTE, '')
      fragment.append(element)
    }
  }
  const end = document.createElement('div')
  end.className = END_OF_CONTENT_CLASS
  fragment.append(end)

  layer.replaceChildren(fragment)
  const unregister = registerTextLayer(layer, end)
  return () => {
    unregister()
    layer.replaceChildren()
  }
}

interface TextLayerProps {
  docId: string
  /** 0-based page index. */
  page: number
  revision: number
  /** Page size in points. */
  width: number
  height: number
  /** CSS pixels per point. */
  scale: number
}

/**
 * The selectable text of a page: transparent spans over the page image, built
 * from the engine's word boxes so the browser's own selection works.
 *
 * The spans are created directly in the DOM rather than through React: there
 * can be thousands, they never change once built, and selection handling
 * moves an element between them.
 */
export const TextLayer = memo(function TextLayer({
  docId,
  page,
  revision,
  width,
  height,
  scale
}: TextLayerProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const text = usePageText(docId, page, revision, true)

  useEffect(() => {
    const layer = ref.current
    if (!layer || !text) return
    return mount(layer, text)
  }, [text])

  return (
    <div
      ref={ref}
      className={TEXT_LAYER_CLASS}
      data-page-index={page}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        fontFamily: FONT_FAMILY,
        transform: `scale(${scale})`
      }}
    />
  )
})
