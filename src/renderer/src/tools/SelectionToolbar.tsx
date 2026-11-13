import { useEffect, useState } from 'react'
import { Highlighter, MessageSquarePlus, Strikethrough, Underline } from 'lucide-react'
import type { MarkupType } from '@/api/engine'
import { commentOnSelection, markSelection } from '@/state/edits'
import { getActiveTab } from '@/state/tabs'
import { isMarkupTool, PALETTE, useTools } from '@/state/tools'
import { selectedWordPieces } from '@/viewer/selection'

const WIDTH = 286
const HEIGHT = 36
/** Swatches shown on the toolbar; the full palette is on the annotation toolbar. */
const SWATCHES = PALETTE.slice(0, 5)

const BUTTONS: { kind: MarkupType; label: string; icon: typeof Highlighter; key: string }[] = [
  { kind: 'highlight', label: 'Highlight', icon: Highlighter, key: 'H' },
  { kind: 'underline', label: 'Underline', icon: Underline, key: 'U' },
  { kind: 'strikeout', label: 'Strikeout', icon: Strikethrough, key: 'K' }
]

/** Where to show the toolbar for the current text selection, or null. */
function placement(): { left: number; top: number } | null {
  const selection = document.getSelection()
  if (selectedWordPieces(selection).length === 0 || !selection) return null
  const rects = [...selection.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0)
  const last = rects[rects.length - 1]
  if (!last) return null
  const left = Math.min(Math.max(last.right - WIDTH / 2, 8), window.innerWidth - WIDTH - 8)
  const below = last.bottom + 8
  const top = below + HEIGHT > window.innerHeight - 40 ? rects[0].top - HEIGHT - 8 : below
  return { left, top }
}

/**
 * The small toolbar that appears over selected text with the Select tool:
 * highlight, underline, strikeout, a colour and "add comment". With a
 * markup tool armed, releasing the mouse after selecting text marks it
 * straight away instead.
 */
export function SelectionToolbar(): React.JSX.Element | null {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  // A swatch picked here applies to the next mark made from this toolbar;
  // otherwise each kind of mark uses its tool's own colour.
  const [color, setColor] = useState<string | null>(null)
  const chosen = color ?? undefined

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = (): void => {
      const tool = useTools.getState().activeTool
      if (tool !== 'select') {
        setPosition(null)
        return
      }
      setPosition(placement())
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
    const onSelectionChange = (): void => {
      if (document.getSelection()?.isCollapsed ?? true) setPosition(null)
    }
    const onScroll = (): void => setPosition((current) => (current ? placement() : current))
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.shiftKey || event.key === 'Shift') later()
    }
    document.addEventListener('pointerup', later)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerup', later)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  if (!position) return null

  const act = (run: (tabId: string) => Promise<unknown>): void => {
    const tab = getActiveTab()
    setPosition(null)
    setColor(null)
    if (tab) void run(tab.id)
  }

  return (
    <div
      role="toolbar"
      aria-label="Selected text"
      className="fixed z-30 flex items-center gap-0.5 rounded-lg border bg-popover px-1.5 text-popover-foreground shadow-lg"
      style={{ left: position.left, top: position.top, width: WIDTH, height: HEIGHT }}
      // Pressing a button must not end the text selection it acts on.
      onMouseDown={(event) => event.preventDefault()}
    >
      {BUTTONS.map(({ kind, label, icon: Icon, key }) => (
        <button
          key={kind}
          type="button"
          title={`${label} (${key})`}
          aria-label={label}
          className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent"
          onClick={() => act((tabId) => markSelection(tabId, kind, { color: chosen }))}
        >
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-border" />
      {SWATCHES.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          title={swatch.label}
          aria-label={`Colour: ${swatch.label}`}
          aria-pressed={chosen === swatch.value}
          className="pdf-swatch mx-0.5 shrink-0"
          style={{ background: swatch.value, width: 16, height: 16 }}
          onClick={() => setColor(swatch.value)}
        />
      ))}
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        title="Highlight and comment"
        aria-label="Add comment"
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent"
        onClick={() => act((tabId) => commentOnSelection(tabId, chosen))}
      >
        <MessageSquarePlus className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
}
