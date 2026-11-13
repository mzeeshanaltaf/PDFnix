import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { DocumentTab } from '@/state/tabs'
import { getViewer } from '@/viewer/controller'
import { formatZoom, parseZoom, ZOOM_PRESETS } from '@/viewer/zoom'

const FIELD =
  'h-7 rounded-md border border-input bg-transparent text-center text-xs tabular-nums outline-none ' +
  'transition-[color,box-shadow] select-text focus-visible:border-ring focus-visible:ring-[3px] ' +
  'focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30'

interface DraftFieldProps {
  /** What the field shows while it is not being edited. */
  value: string
  /** Called with what was typed. Return false to reject it. */
  onCommit: (text: string) => boolean
  label: string
  className?: string
  disabled?: boolean
}

/**
 * A small text field that shows a value from elsewhere and lets it be
 * overwritten: typing edits a draft, Enter applies it, Escape or leaving the
 * field drops it.
 */
function DraftField({
  value,
  onCommit,
  label,
  className,
  disabled
}: DraftFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      spellCheck={false}
      disabled={disabled}
      value={draft ?? value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          if (draft !== null) onCommit(draft)
          setDraft(null)
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
      className={cn(FIELD, className)}
    />
  )
}

/** The current page number, editable, with the page count beside it. */
export function PageNumberBox({ tab }: { tab: DocumentTab | null }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
      <DraftField
        label="Page number"
        className="w-11 text-foreground"
        disabled={!tab}
        value={tab ? String(tab.page + 1) : ''}
        onCommit={(text) => {
          const page = Number.parseInt(text, 10)
          if (!tab || !Number.isFinite(page)) return false
          getViewer(tab.id)?.goToPage(page - 1)
          return true
        }}
      />
      <span className="whitespace-nowrap tabular-nums" aria-label="Page count">
        / {tab ? tab.pageCount.toLocaleString() : '–'}
      </span>
    </div>
  )
}

/** The zoom level: type a percentage, or pick a preset or a fit mode. */
export function ZoomBox({ tab }: { tab: DocumentTab | null }): React.JSX.Element {
  return (
    <div className="flex items-center">
      <DraftField
        label="Zoom level"
        className="w-14 rounded-r-none border-r-0 text-foreground"
        disabled={!tab}
        value={tab ? formatZoom(tab.zoom) : '100%'}
        onCommit={(text) => {
          const zoom = parseZoom(text)
          if (!tab || zoom === null) return false
          getViewer(tab.id)?.zoomTo(zoom)
          return true
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!tab}>
          <button
            type="button"
            aria-label="Zoom presets"
            className="inline-flex h-7 w-5 items-center justify-center rounded-r-md border border-input text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 data-[state=open]:bg-accent dark:bg-input/30"
          >
            <ChevronDown className="size-3" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuItem onSelect={() => tab && getViewer(tab.id)?.setZoomMode('fit-width')}>
            Fit width
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => tab && getViewer(tab.id)?.setZoomMode('fit-page')}>
            Fit page
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {ZOOM_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset}
              onSelect={() => tab && getViewer(tab.id)?.zoomTo(preset)}
              className="tabular-nums"
            >
              {formatZoom(preset)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
