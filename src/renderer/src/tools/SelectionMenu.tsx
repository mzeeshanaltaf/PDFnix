import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Copy,
  EyeOff,
  Highlighter,
  MessageSquarePlus,
  Palette,
  Strikethrough,
  TextCursorInput,
  Underline,
  type LucideIcon
} from 'lucide-react'
import { cn } from 'cn'
import type { MarkupType } from '@/api/engine'
import { copyText } from '@/lib/clipboard'
import { commentOnSelection, markSelection } from '@/state/edits'
import { editSelectedText } from '@/state/pending'
import { markTextSelection } from '@/state/redaction'
import { getActiveTab } from '@/state/tabs'
import { isMarkupTool, PALETTE, useTools } from '@/state/tools'
import { selectedLayerText, selectedWordPieces } from '@/viewer/selection'
import {
  menuPlacement,
  selectionMenuSections,
  selectionMenuSectionsSnapshot,
  subscribeSelectionMenuSections,
  useSelectionMenu,
  type MenuAnchor,
  type SelectionContext,
  type SelectionMenuItem,
  type Size
} from './selectionMenuState'

const WIDTH = 300
/** Swatches offered by the colour button; the full palette is on the annotation toolbar. */
const SWATCHES = PALETTE.slice(0, 5)

const MARKS: { kind: MarkupType; label: string; icon: LucideIcon; key: string }[] = [
  { kind: 'highlight', label: 'Highlight', icon: Highlighter, key: 'H' },
  { kind: 'underline', label: 'Underline', icon: Underline, key: 'U' },
  { kind: 'strikeout', label: 'Strikeout', icon: Strikethrough, key: 'K' }
]

/** The client rects of the selected page text, or null when no page text is selected. */
function selectionAnchor(): MenuAnchor | null {
  const selection = document.getSelection()
  if (!selection || selectedWordPieces(selection).length === 0) return null
  const rects = [...selection.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0)
  return rects.length > 0 ? { rects } : null
}

/** The selection as it is now, for an item another feature added. */
function selectionContext(): SelectionContext | null {
  const tab = getActiveTab()
  const selection = document.getSelection()
  const pieces = selectedWordPieces(selection)
  if (!tab || pieces.length === 0) return null
  return { tabId: tab.id, text: selectedLayerText(selection) ?? '', page: pieces[0].page, pieces }
}

const ICON_BUTTON =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring'
const ROW_BUTTON =
  'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring'

function Separator(): React.JSX.Element {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />
}

/**
 * The menu over selected text (Select tool): a row of markup buttons
 * (comment, highlight, underline, strikeout, redact, colour), then Copy text
 * and Edit text, then any sections other features registered. It opens when
 * a selection is made with the mouse or Shift+keys, and on right-click over
 * selected text. With a markup tool armed, releasing the mouse marks the text
 * straight away instead.
 *
 * Focus stays on the page, so H/U/K, Ctrl+C and the other keys keep working
 * while it is open; every action reads the live selection, which pressing a
 * button must therefore not end.
 */
export function SelectionMenu(): React.JSX.Element | null {
  const anchor = useSelectionMenu((state) => state.anchor)
  // Re-renders when a section is added or removed.
  const registered = useSyncExternalStore(
    subscribeSelectionMenuSections,
    selectionMenuSectionsSnapshot
  )
  const sections = selectionMenuSections()
  // A colour picked here applies to the next mark made from the menu;
  // otherwise each kind of mark uses its tool's own colour.
  const [color, setColor] = useState<string | null>(null)
  const chosen = color ?? undefined
  // The swatches stay open for the menu they were opened in.
  const [swatchesFor, setSwatchesFor] = useState<MenuAnchor | null>(null)
  const swatchesOpen = anchor !== null && swatchesFor === anchor
  const [size, setSize] = useState<Size | null>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const { show, hide } = useSelectionMenu.getState()
    const isOpen = (): boolean => useSelectionMenu.getState().anchor !== null
    let timer: ReturnType<typeof setTimeout> | undefined

    const update = (): void => {
      const anchor = useTools.getState().activeTool === 'select' ? selectionAnchor() : null
      if (anchor) show(anchor)
      else hide()
    }
    const later = (): void => {
      clearTimeout(timer)
      // Let the selection settle after the button is released.
      timer = setTimeout(() => {
        const tool = useTools.getState().activeTool
        const tab = getActiveTab()
        if (isMarkupTool(tool) && tab && selectedWordPieces(document.getSelection()).length > 0) {
          void markSelection(tab.id, tool)
          return
        }
        update()
      }, 0)
    }
    const onPointerUp = (event: PointerEvent): void => {
      // A right-click opens the menu at the pointer (PageList); a press in
      // the menu is the menu's own.
      if (event.button !== 0) return
      if (event.target instanceof Node && menu.current?.contains(event.target)) return
      later()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.shiftKey || event.key === 'Shift') later()
    }
    const onSelectionChange = (): void => {
      if ((document.getSelection()?.isCollapsed ?? true) && isOpen()) hide()
    }
    const follow = (): void => {
      if (!isOpen()) return
      const anchor = selectionAnchor()
      if (anchor) show(anchor)
      else hide()
    }
    // Escape closes the menu and keeps the selection; the next Escape is the
    // usual one (edit.escape).
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !isOpen() || event.defaultPrevented) return
      event.preventDefault()
      hide()
    }
    const stopTools = useTools.subscribe((state, previous) => {
      if (state.activeTool !== previous.activeTool && state.activeTool !== 'select') hide()
    })

    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      clearTimeout(timer)
      stopTools()
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [])

  // Measure the card as drawn (its height depends on the swatches and the
  // sections) before it is shown.
  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return
    const width = element.offsetWidth
    const height = element.offsetHeight
    setSize((previous) =>
      previous?.width === width && previous.height === height ? previous : { width, height }
    )
  }, [anchor, swatchesOpen, registered])

  if (!anchor) return null

  const position = size
    ? menuPlacement(anchor, size, { width: window.innerWidth, height: window.innerHeight })
    : null

  /** Closes the menu, then runs the action on the active tab. */
  const act = (run: (tabId: string) => unknown): void => {
    const tab = getActiveTab()
    useSelectionMenu.getState().hide()
    setColor(null)
    setSwatchesFor(null)
    if (tab) void run(tab.id)
  }

  const runItem = (item: SelectionMenuItem): void => {
    // Taken before the menu closes or anything clears the selection.
    const context = selectionContext()
    act(() => (context ? item.run(context) : undefined))
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Selected text"
      aria-orientation="vertical"
      className="fixed z-30 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{
        width: WIDTH,
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden'
      }}
      // Pressing a button must not end the text selection it acts on.
      onMouseDown={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div role="group" aria-label="Mark up" className="flex items-center justify-between px-0.5">
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          title="Comment"
          aria-label="Comment"
          className={ICON_BUTTON}
          onClick={() => act((tabId) => commentOnSelection(tabId, chosen))}
        >
          <MessageSquarePlus className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        {MARKS.map(({ kind, label, icon: Icon, key }) => (
          <button
            key={kind}
            type="button"
            role="menuitem"
            tabIndex={-1}
            title={`${label} (${key})`}
            aria-label={label}
            aria-keyshortcuts={key}
            className={ICON_BUTTON}
            onClick={() => act((tabId) => markSelection(tabId, kind, { color: chosen }))}
          >
            <Icon className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          title="Mark for redaction (R)"
          aria-label="Redact"
          aria-keyshortcuts="R"
          className={ICON_BUTTON}
          onClick={() => act((tabId) => markTextSelection(tabId))}
        >
          <EyeOff className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          title="Colour"
          aria-label="Colour"
          aria-haspopup="true"
          aria-expanded={swatchesOpen}
          className={cn(ICON_BUTTON, swatchesOpen && 'bg-accent')}
          onClick={() => setSwatchesFor(swatchesOpen ? null : anchor)}
        >
          {color ? (
            <span
              className="pdf-swatch"
              style={{ background: color, width: 16, height: 16 }}
              aria-hidden
            />
          ) : (
            <Palette className="size-4" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </div>
      {swatchesOpen && (
        <div
          role="group"
          aria-label="Colours"
          className="flex items-center justify-end gap-1.5 px-1.5 pt-1 pb-0.5"
        >
          {SWATCHES.map((swatch) => (
            <button
              key={swatch.value}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              title={swatch.label}
              aria-label={`Colour: ${swatch.label}`}
              aria-checked={color === swatch.value}
              className="pdf-swatch shrink-0"
              style={{ background: swatch.value, width: 18, height: 18 }}
              onClick={() => setColor(color === swatch.value ? null : swatch.value)}
            />
          ))}
        </div>
      )}
      <Separator />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={ROW_BUTTON}
        onClick={() => act(() => copyText(selectedLayerText(document.getSelection()) ?? ''))}
      >
        <Copy className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        Copy text
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={ROW_BUTTON}
        onClick={() => act((tabId) => editSelectedText(tabId))}
      >
        <TextCursorInput className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        Edit text
      </button>
      {sections.map((section) => (
        <div key={section.id} role="group" aria-label={section.label ?? section.id}>
          <Separator />
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={ROW_BUTTON}
              onClick={() => runItem(item)}
            >
              <item.icon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              {item.label}
            </button>
          ))}
          {section.note && (
            <p className="px-2 pt-0.5 pb-1 text-xs text-muted-foreground">{section.note}</p>
          )}
        </div>
      ))}
    </div>
  )
}
