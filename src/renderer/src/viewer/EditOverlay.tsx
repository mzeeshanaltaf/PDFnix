import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CalendarDays,
  Check,
  Italic,
  RotateCw,
  Trash2
} from 'lucide-react'
import { cn } from 'cn'
import type { FontFamily, Rect, Rotation, TextAlign } from '@/api/engine'
import {
  cancelPending,
  commitPending,
  objectBounds,
  startPending,
  usePending,
  type Pending,
  type PendingObject
} from '@/state/pending'
import { useTools, INK_PALETTE } from '@/state/tools'
import {
  clampToPage,
  HANDLES,
  lineEnd,
  mapPoint,
  moveRect,
  quarterTurnRect,
  rectHeight,
  rectWidth,
  resizeRect,
  type Handle
} from './editGeometry'
import { CSS_FONTS, TEXT_LINE_HEIGHT, trackDrag } from './editDom'
import { cssScale, rectToPx, type Point, type PxBox } from './geometry'

const BAR_HEIGHT = 34
const BAR_GAP = 6
const FAMILY_LABELS: Record<FontFamily, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono' }
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72]
const WIDTHS = [1, 2, 3, 4, 6, 8]
const OPACITIES = [1, 0.75, 0.5, 0.25]

/** The eight resize handles around a box (CSS pixels, relative to the page). */
export function ResizeHandles({
  box,
  onStart
}: {
  box: PxBox
  onStart: (handle: Handle, event: React.PointerEvent<HTMLElement>) => void
}): React.JSX.Element {
  return (
    <>
      {HANDLES.map((handle) => {
        const x = handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5
        const y = handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5
        return (
          <div
            key={handle}
            className={cn('pdf-handle', `pdf-handle-${handle}`)}
            style={{ left: box.left + x * box.width, top: box.top + y * box.height }}
            onPointerDown={(event) => onStart(handle, event)}
          />
        )
      })}
    </>
  )
}

/** The object moved by `dx, dy` points. */
function moved(
  object: PendingObject,
  start: PendingObject,
  dx: number,
  dy: number,
  page: Size2
): PendingObject {
  switch (start.kind) {
    case 'line':
      return { ...start, points: [shift(start.points[0], dx, dy), shift(start.points[1], dx, dy)] }
    case 'ink':
      return {
        ...start,
        strokes: start.strokes.map((stroke) => stroke.map((p) => shift(p, dx, dy)))
      }
    default:
      return object.kind === start.kind
        ? { ...start, rect: clampToPage(moveRect(start.rect, dx, dy), page) }
        : object
  }
}

interface Size2 {
  width: number
  height: number
}

function shift(point: Point, dx: number, dy: number): Point {
  return { x: point.x + dx, y: point.y + dy }
}

/** The object scaled so that its bounds become `target`. */
function resized(start: PendingObject, target: Rect): PendingObject {
  const from = objectBounds(start)
  switch (start.kind) {
    case 'line':
      return {
        ...start,
        points: [mapPoint(start.points[0], from, target), mapPoint(start.points[1], from, target)]
      }
    case 'ink':
      return {
        ...start,
        strokes: start.strokes.map((stroke) => stroke.map((point) => mapPoint(point, from, target)))
      }
    default:
      return { ...start, rect: target }
  }
}

function hexOk(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
}

function Swatches({
  value,
  onChange,
  label
}: {
  value: string | null
  onChange: (color: string) => void
  label: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[3px]" role="group" aria-label={label}>
      {INK_PALETTE.slice(0, 6).map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          title={`${label}: ${swatch.label}`}
          aria-label={`${label}: ${swatch.label}`}
          aria-pressed={value === swatch.value}
          className="pdf-swatch small"
          style={{ background: swatch.value }}
          onClick={() => onChange(swatch.value)}
        />
      ))}
      <input
        type="color"
        title={`${label}: other`}
        aria-label={`${label}: other colour`}
        className="pdf-color-input"
        value={hexOk(value ?? '#000000')}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function BarButton({
  label,
  pressed,
  onClick,
  children
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn('pdf-annotation-button', pressed && 'pressed')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Separator(): React.JSX.Element {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-black/15" />
}

/** Font, size, colour, bold, italic, alignment: shared by new and edited text. */
function TextControls({
  family,
  size,
  color,
  bold,
  italic,
  align,
  allowOriginal,
  onChange
}: {
  family: FontFamily | null
  size: number
  color: string
  bold: boolean
  italic: boolean
  align: TextAlign
  allowOriginal: boolean
  onChange: (patch: {
    fontFamily?: FontFamily | null
    fontSize?: number
    color?: string
    bold?: boolean
    italic?: boolean
    align?: TextAlign
  }) => void
}): React.JSX.Element {
  const sizes = SIZES.includes(size) ? SIZES : [...SIZES, size].sort((a, b) => a - b)
  return (
    <>
      <select
        aria-label="Font"
        className="pdf-bar-select"
        value={family ?? 'original'}
        onChange={(event) =>
          onChange({
            fontFamily:
              event.target.value === 'original' ? null : (event.target.value as FontFamily)
          })
        }
      >
        {allowOriginal && <option value="original">Original font</option>}
        {(Object.keys(FAMILY_LABELS) as FontFamily[]).map((key) => (
          <option key={key} value={key}>
            {FAMILY_LABELS[key]}
          </option>
        ))}
      </select>
      <select
        aria-label="Font size"
        className="pdf-bar-select w-[52px]"
        value={size}
        onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
      >
        {sizes.map((value) => (
          <option key={value} value={value}>
            {Math.round(value * 10) / 10}
          </option>
        ))}
      </select>
      <Swatches
        label="Text colour"
        value={color}
        onChange={(value) => onChange({ color: value })}
      />
      <Separator />
      <BarButton label="Bold" pressed={bold} onClick={() => onChange({ bold: !bold })}>
        <Bold className="size-4" aria-hidden />
      </BarButton>
      <BarButton label="Italic" pressed={italic} onClick={() => onChange({ italic: !italic })}>
        <Italic className="size-4" aria-hidden />
      </BarButton>
      <Separator />
      {(
        [
          ['left', AlignLeft],
          ['center', AlignCenter],
          ['right', AlignRight]
        ] as const
      ).map(([value, Icon]) => (
        <BarButton
          key={value}
          label={`Align ${value}`}
          pressed={align === value}
          onClick={() => onChange({ align: value })}
        >
          <Icon className="size-4" aria-hidden />
        </BarButton>
      ))}
    </>
  )
}

function StrokeControls({
  object,
  update
}: {
  object: Extract<PendingObject, { kind: 'shape' | 'line' | 'ink' }>
  update: (object: PendingObject) => void
}): React.JSX.Element {
  const style = object.style
  const remember = (patch: Partial<typeof style>): void => {
    if (object.kind === 'ink') useTools.getState().setPen(patch)
    else useTools.getState().setShape(patch)
  }
  const set = (patch: Partial<typeof style>): void => {
    remember(patch)
    update({ ...object, style: { ...style, ...patch } } as PendingObject)
  }
  return (
    <>
      <Swatches label="Line colour" value={style.color} onChange={(color) => set({ color })} />
      {object.kind === 'shape' && (
        <>
          <Separator />
          <BarButton
            label="No fill"
            pressed={object.style.fill === null}
            onClick={() => set({ fill: null } as Partial<typeof style>)}
          >
            <span className="pdf-no-fill" aria-hidden />
          </BarButton>
          <Swatches
            label="Fill"
            value={object.style.fill}
            onChange={(fill) => set({ fill } as Partial<typeof style>)}
          />
        </>
      )}
      <Separator />
      <select
        aria-label="Line width"
        className="pdf-bar-select w-[56px]"
        value={style.width}
        onChange={(event) => set({ width: Number(event.target.value) })}
      >
        {WIDTHS.map((width) => (
          <option key={width} value={width}>
            {width} pt
          </option>
        ))}
      </select>
      <select
        aria-label="Opacity"
        className="pdf-bar-select w-[60px]"
        value={style.opacity}
        onChange={(event) => set({ opacity: Number(event.target.value) })}
      >
        {OPACITIES.map((opacity) => (
          <option key={opacity} value={opacity}>
            {Math.round(opacity * 100)} %
          </option>
        ))}
      </select>
    </>
  )
}

/** "This page / all pages / pages a–b" for signatures and initials. */
function PagesControl({
  object,
  page,
  pageCount,
  update
}: {
  object: Extract<PendingObject, { kind: 'image' }>
  page: number
  pageCount: number
  update: (object: PendingObject) => void
}): React.JSX.Element {
  const others = object.pages ?? []
  const mode = others.length === 0 ? 'this' : others.length === pageCount - 1 ? 'all' : 'range'
  const [range, setRange] = useState({ from: 1, to: pageCount })
  const setPages = (from: number, to: number): void => {
    const pages: number[] = []
    for (let index = Math.max(0, from - 1); index <= Math.min(pageCount - 1, to - 1); index += 1) {
      if (index !== page) pages.push(index)
    }
    update({ ...object, pages })
  }
  return (
    <>
      <select
        aria-label="Pages"
        className="pdf-bar-select"
        value={mode}
        onChange={(event) => {
          if (event.target.value === 'this') update({ ...object, pages: [] })
          else if (event.target.value === 'all') setPages(1, pageCount)
          else setPages(range.from, range.to)
        }}
      >
        <option value="this">This page</option>
        <option value="all">All pages</option>
        <option value="range">Pages…</option>
      </select>
      {mode === 'range' && (
        <span className="flex items-center gap-1 text-[12px]">
          {(['from', 'to'] as const).map((key) => (
            <input
              key={key}
              type="number"
              min={1}
              max={pageCount}
              aria-label={key === 'from' ? 'First page' : 'Last page'}
              className="pdf-bar-number"
              value={range[key]}
              onChange={(event) => {
                const next = { ...range, [key]: Number(event.target.value) || 1 }
                setRange(next)
                setPages(next.from, next.to)
              }}
            />
          ))}
        </span>
      )}
    </>
  )
}

function today(): string {
  return new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function PropertiesBar({
  pending,
  box,
  pageWidth,
  pageCount
}: {
  pending: Pending
  box: PxBox
  pageWidth: number
  pageCount: number
}): React.JSX.Element {
  const update = (object: PendingObject): void => usePending.getState().update(() => object)
  const { object } = pending
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => setWidth(ref.current?.offsetWidth ?? 0), [object.kind])
  const above = box.top - BAR_HEIGHT - BAR_GAP
  const top = above >= 0 ? above : box.top + box.height + BAR_GAP
  const left = Math.min(Math.max(box.left, 4), Math.max(4, pageWidth - width - 4))

  let controls: React.ReactNode
  if (object.kind === 'text') {
    controls = (
      <>
        <TextControls
          family={object.style.fontFamily}
          size={object.style.fontSize}
          color={object.style.color}
          bold={object.style.bold}
          italic={object.style.italic}
          align={object.style.align}
          allowOriginal={false}
          onChange={(patch) => {
            const style = {
              ...object.style,
              ...patch,
              fontFamily: patch.fontFamily ?? object.style.fontFamily
            }
            useTools.getState().setText(style)
            update({ ...object, style })
          }}
        />
        <Separator />
        <BarButton
          label="Rotate 90°"
          onClick={() =>
            update({
              ...object,
              rect: quarterTurnRect(object.rect),
              rotation: ((object.rotation + 90) % 360) as Rotation
            })
          }
        >
          <RotateCw className="size-4" aria-hidden />
        </BarButton>
      </>
    )
  } else if (object.kind === 'editText') {
    controls = (
      <TextControls
        family={object.style.fontFamily}
        size={object.style.fontSize}
        color={object.style.color}
        bold={object.style.bold}
        italic={object.style.italic}
        align={object.style.align}
        allowOriginal
        onChange={(patch) =>
          update({
            ...object,
            style: {
              ...object.style,
              ...patch,
              fontFamily:
                'fontFamily' in patch ? (patch.fontFamily ?? null) : object.style.fontFamily
            }
          })
        }
      />
    )
  } else if (object.kind === 'image') {
    controls = (
      <>
        <BarButton
          label="Rotate 90°"
          onClick={() =>
            update({
              ...object,
              rect: quarterTurnRect(object.rect),
              rotation: ((object.rotation + 90) % 360) as Rotation
            })
          }
        >
          <RotateCw className="size-4" aria-hidden />
        </BarButton>
        {object.label !== 'Image' && pageCount > 1 && (
          <>
            <Separator />
            <PagesControl
              object={object}
              page={pending.page}
              pageCount={pageCount}
              update={update}
            />
          </>
        )}
        {object.label === 'Signature' && (
          <>
            <Separator />
            <BarButton
              label="Add date next to it"
              onClick={() => {
                const rect = object.rect
                const size = 11
                const height = size * TEXT_LINE_HEIGHT + 2
                const middle = (rect[1] + rect[3]) / 2
                startPending({
                  tabId: pending.tabId,
                  page: pending.page,
                  object: {
                    kind: 'text',
                    rect: [
                      rect[2] + 8,
                      middle - height / 2,
                      rect[2] + 8 + 110,
                      middle + height / 2
                    ],
                    text: today(),
                    style: { ...useTools.getState().text, fontSize: size },
                    rotation: 0
                  }
                })
              }}
            >
              <CalendarDays className="size-4" aria-hidden />
            </BarButton>
          </>
        )}
      </>
    )
  } else {
    controls = <StrokeControls object={object} update={update} />
  }

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Properties"
      className="pdf-annotation-toolbar pdf-properties-bar"
      style={{ top, left }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {controls}
      <Separator />
      <BarButton label="Done (Enter)" onClick={() => void commitPending()}>
        <Check className="size-4" aria-hidden />
      </BarButton>
      <BarButton label="Discard" onClick={cancelPending}>
        <Trash2 className="size-4" aria-hidden />
      </BarButton>
    </div>
  )
}

/** What a pending shape, line or drawing looks like (inside its box). */
function ShapePreview({
  object,
  bounds,
  scale
}: {
  object: Extract<PendingObject, { kind: 'shape' | 'line' | 'ink' }>
  bounds: Rect
  scale: number
}): React.JSX.Element {
  const { style } = object
  const stroke = style.width * scale
  const x = (value: number): number => (value - bounds[0]) * scale
  const y = (value: number): number => (value - bounds[1]) * scale
  const width = rectWidth(bounds) * scale
  const height = rectHeight(bounds) * scale
  const common = {
    stroke: style.color,
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    opacity: style.opacity
  }
  let content: React.ReactNode
  if (object.kind === 'shape') {
    const fill = object.style.fill ?? 'none'
    content =
      object.shape === 'square' ? (
        <rect
          x={stroke / 2}
          y={stroke / 2}
          width={Math.max(0, width - stroke)}
          height={Math.max(0, height - stroke)}
          fill={fill}
          {...common}
        />
      ) : (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={Math.max(0, width / 2 - stroke / 2)}
          ry={Math.max(0, height / 2 - stroke / 2)}
          fill={fill}
          {...common}
        />
      )
  } else if (object.kind === 'line') {
    const [a, b] = object.points
    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const head = Math.max(8, style.width * 4) * scale
    const tip = { x: x(b.x), y: y(b.y) }
    const wing = (side: number): string =>
      `${tip.x - head * Math.cos(angle + side * 0.45)},${tip.y - head * Math.sin(angle + side * 0.45)}`
    content = (
      <>
        <line x1={x(a.x)} y1={y(a.y)} x2={tip.x} y2={tip.y} {...common} />
        {object.arrow && (
          <polyline points={`${wing(1)} ${tip.x},${tip.y} ${wing(-1)}`} fill="none" {...common} />
        )}
      </>
    )
  } else {
    content = object.strokes.map((stroke, index) => (
      <polyline
        key={index}
        points={stroke.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')}
        fill="none"
        {...common}
      />
    ))
  }
  return (
    <svg className="pdf-shape-preview" width={width} height={height} aria-hidden>
      {content}
    </svg>
  )
}

/** The text box of a pending text: a text area styled like the result. */
function TextEditor({
  pending,
  scale
}: {
  pending: Pending & { object: Extract<PendingObject, { kind: 'text' | 'editText' }> }
  scale: number
}): React.JSX.Element {
  const { object } = pending
  const ref = useRef<HTMLTextAreaElement>(null)
  const rotation = object.rotation
  const turned = rotation === 90 || rotation === 270
  const width = (turned ? rectHeight(object.rect) : rectWidth(object.rect)) * scale
  const height = (turned ? rectWidth(object.rect) : rectHeight(object.rect)) * scale
  const style = object.style
  // Over text that is already drawn (page text, or a text box being retyped),
  // hide it so it does not show through.
  const replacing = object.kind === 'editText' || object.annotId !== undefined
  const background = object.kind === 'text' && object.fill ? object.fill : undefined
  const family =
    style.fontFamily === null && object.kind === 'editText'
      ? `"${object.fontName}", ${CSS_FONTS.sans}`
      : CSS_FONTS[style.fontFamily ?? 'sans']

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
    // Focus once, when the editor opens.
  }, [])

  // New text boxes grow downward with their text.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || object.kind !== 'text' || turned) return
    const needed = element.scrollHeight / scale
    const current = rectHeight(object.rect)
    if (needed > current + 0.5) {
      usePending.getState().update((latest) =>
        latest.kind === 'text'
          ? {
              ...latest,
              rect: [latest.rect[0], latest.rect[1], latest.rect[2], latest.rect[1] + needed]
            }
          : latest
      )
    }
  })

  return (
    <textarea
      ref={ref}
      aria-label={object.kind === 'text' ? 'Text box' : 'Edit text'}
      className={cn('pdf-text-editor', replacing && 'replacing')}
      spellCheck
      value={object.text}
      style={{
        width,
        height,
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        fontFamily: family,
        fontSize: style.fontSize * scale,
        lineHeight: TEXT_LINE_HEIGHT,
        color: style.color,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        textAlign: style.align,
        ...(background ? { background } : {})
      }}
      onChange={(event) => {
        const text = event.target.value
        usePending
          .getState()
          .update((latest) =>
            latest.kind === 'text' || latest.kind === 'editText' ? { ...latest, text } : latest
          )
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault()
          event.stopPropagation()
          void commitPending()
        }
      }}
    />
  )
}

/**
 * The pending object on its page: what it will look like, handles to move and
 * resize it, and its properties bar.
 */
export function EditOverlay({
  pending,
  zoom,
  pageWidth,
  pageHeight,
  pageCount,
  passive = false
}: {
  pending: Pending
  zoom: number
  /** Page size in points. */
  pageWidth: number
  pageHeight: number
  pageCount: number
  /** Shown only: the pen is still adding strokes to it. */
  passive?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { object } = pending
  const scale = cssScale(zoom)
  const bounds = objectBounds(object)
  const box = rectToPx(bounds, zoom)
  const page = { width: pageWidth, height: pageHeight }
  const typing = object.kind === 'text' || object.kind === 'editText'

  // A press anywhere else commits. Presses on a page's edit surface are left
  // to it: with the pen, a new stroke joins the drawing instead.
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-edit-surface]')) return
      void commitPending()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])

  // Keys for objects without a text box: Enter commits, Escape and Delete
  // discard, arrows nudge. Caught before the app's shortcuts see them.
  useEffect(() => {
    if (typing) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return
      if (event.ctrlKey || event.altKey || event.metaKey) return
      const step = event.shiftKey ? 10 : 1
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }
      if (event.key === 'Enter') void commitPending()
      else if (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace')
        cancelPending()
      else if (nudge[event.key]) {
        const [dx, dy] = nudge[event.key]
        usePending.getState().update((latest) => moved(latest, latest, dx, dy, page))
      } else return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const startMove = (event: React.PointerEvent<HTMLElement>): void => {
    // In a text box the pointer places the cursor and selects text.
    if (event.target instanceof HTMLTextAreaElement) return
    const start = object
    trackDrag(event, zoom, (delta) =>
      usePending.getState().update((latest) => moved(latest, start, delta.x, delta.y, page))
    )
  }

  const startResize = (handle: Handle, event: React.PointerEvent<HTMLElement>): void => {
    const start = object
    const from = objectBounds(start)
    trackDrag(event, zoom, (delta, pointer) => {
      let aspect: number | null = null
      if (start.kind === 'image') {
        // Images keep their shape unless Shift is held.
        if (!pointer.shiftKey) aspect = rectWidth(from) / rectHeight(from)
      } else if (pointer.shiftKey) {
        aspect = rectWidth(from) / rectHeight(from)
      }
      const target = resizeRect(from, handle, delta.x, delta.y, { aspect })
      usePending.getState().update(() => resized(start, target))
    })
  }

  const startEndpoint = (index: 0 | 1, event: React.PointerEvent<HTMLElement>): void => {
    if (object.kind !== 'line') return
    const start = object
    trackDrag(event, zoom, (delta, pointer) => {
      const fixed = start.points[1 - index]
      const free = lineEnd(fixed, shift(start.points[index], delta.x, delta.y), pointer.shiftKey)
      const points: [Point, Point] = index === 0 ? [free, fixed] : [fixed, free]
      usePending
        .getState()
        .update((latest) => (latest.kind === 'line' ? { ...latest, points } : latest))
    })
  }

  let body: React.ReactNode
  if (object.kind === 'text' || object.kind === 'editText') {
    body = <TextEditor pending={pending as Pending & { object: typeof object }} scale={scale} />
  } else if (object.kind === 'image') {
    const turned = object.rotation === 90 || object.rotation === 270
    body = (
      <img
        src={object.url}
        alt=""
        draggable={false}
        className="pdf-image-preview"
        style={{
          width: turned ? box.height : box.width,
          height: turned ? box.width : box.height,
          transform: `translate(-50%, -50%) rotate(${object.rotation}deg)`
        }}
      />
    )
  } else {
    body = <ShapePreview object={object} bounds={bounds} scale={scale} />
  }

  return (
    <div ref={ref} className="pdf-edit-overlay" data-kind={object.kind}>
      <div
        className={cn('pdf-edit-box', typing && 'typing', passive && 'passive')}
        style={box}
        onPointerDown={passive ? undefined : startMove}
      >
        {body}
      </div>
      {passive ? null : object.kind === 'line' ? (
        object.points.map((point, index) => (
          <div
            key={index}
            className="pdf-handle"
            style={{ left: point.x * scale, top: point.y * scale }}
            onPointerDown={(event) => startEndpoint(index as 0 | 1, event)}
          />
        ))
      ) : (
        <ResizeHandles box={box} onStart={startResize} />
      )}
      <PropertiesBar
        pending={pending}
        box={box}
        pageWidth={pageWidth * scale}
        pageCount={pageCount}
      />
    </div>
  )
}
