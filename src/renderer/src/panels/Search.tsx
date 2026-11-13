import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, WholeWord, X, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FOCUS_SEARCH_EVENT } from '@/shell/commands'
import { activateHit, stepSearch, updateSearch } from '@/state/documents'
import type { DocumentTab } from '@/state/tabs'
import { groupHits, type SearchRow } from './searchRows'
import { VirtualList } from './VirtualList'

const HEADER_HEIGHT = 26
const HIT_HEIGHT = 46

type Row = SearchRow

function rowHeight(row: Row): number {
  return row.kind === 'page' ? HEADER_HEIGHT : HIT_HEIGHT
}

function rowKey(row: Row): string {
  return row.kind === 'page' ? `p${row.page}` : `h${row.index}`
}

interface OptionButtonProps {
  icon: LucideIcon
  label: string
  pressed: boolean
  onToggle: () => void
}

function OptionButton({
  icon: Icon,
  label,
  pressed,
  onToggle
}: OptionButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onToggle}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none',
            'transition-colors focus-visible:ring-2 focus-visible:ring-ring/60',
            pressed
              ? 'bg-primary/12 text-primary hover:bg-primary/16'
              : 'text-foreground/70 hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function statusText(tab: DocumentTab): string {
  const { status, hits, truncated, activeIndex, query, error } = tab.search
  if (query.trim() === '') return 'Type to search this document'
  if (status === 'searching') return 'Searching…'
  if (status === 'error') return error ?? 'The search failed'
  if (status !== 'done') return ''
  if (hits.length === 0) return 'No results'
  const total = `${hits.length.toLocaleString()}${truncated ? '+' : ''}`
  const position = activeIndex >= 0 ? `${(activeIndex + 1).toLocaleString()} of ` : ''
  return `${position}${total} ${hits.length === 1 ? 'result' : 'results'}`
}

/** Find in document: the query, its options and the list of results. */
export function Search({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const { id, search } = tab
  const rows = useMemo(() => groupHits(search.hits), [search.hits])
  const activeRow = useMemo(
    () => rows.findIndex((row) => row.kind === 'hit' && row.index === search.activeIndex),
    [rows, search.activeIndex]
  )

  // Ctrl+F while the panel is already open puts the cursor back in the box.
  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    focus()
    window.addEventListener(FOCUS_SEARCH_EVENT, focus)
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus)
  }, [id])

  const renderRow = useCallback(
    (row: Row) => {
      if (row.kind === 'page') {
        return (
          <div className="flex h-full items-end justify-between px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <span>Page {row.page + 1}</span>
            <span className="font-normal tabular-nums">{row.count}</span>
          </div>
        )
      }
      const active = row.index === search.activeIndex
      return (
        <button
          type="button"
          aria-current={active || undefined}
          onClick={() => activateHit(id, row.index)}
          className={cn(
            'mx-1.5 block h-[42px] w-[calc(100%-0.75rem)] rounded-md px-2 text-left text-[12.5px] leading-[18px] outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring/60',
            active ? 'bg-primary/12' : 'hover:bg-accent'
          )}
        >
          <span className="line-clamp-2 break-words text-foreground/75">
            {row.hit.before}
            <mark className="rounded-[2px] bg-search-hit px-px font-semibold text-search-hit-foreground">
              {row.hit.match}
            </mark>
            {row.hit.after}
          </span>
        </button>
      )
    },
    [id, search.activeIndex]
  )

  const hasHits = search.hits.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-2.5">
        <div className="relative">
          <Input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label="Find in document"
            placeholder="Find in document"
            spellCheck={false}
            value={search.query}
            onChange={(event) => updateSearch(id, { query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                stepSearch(id, event.shiftKey ? -1 : 1)
              } else if (event.key === 'Escape' && search.query !== '') {
                event.preventDefault()
                updateSearch(id, { query: '' })
              }
            }}
            className="h-8 pr-8 text-[13px] md:text-[13px]"
          />
          {search.query !== '' && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                updateSearch(id, { query: '' })
                inputRef.current?.focus()
              }}
              className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <OptionButton
            icon={CaseSensitive}
            label="Match case"
            pressed={search.matchCase}
            onToggle={() => updateSearch(id, { matchCase: !search.matchCase })}
          />
          <OptionButton
            icon={WholeWord}
            label="Whole word"
            pressed={search.wholeWord}
            onToggle={() => updateSearch(id, { wholeWord: !search.wholeWord })}
          />
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Previous result"
                aria-disabled={!hasHits || undefined}
                onClick={() => stepSearch(id, -1)}
                className="inline-flex size-7 items-center justify-center rounded-md text-foreground/70 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 aria-disabled:text-muted-foreground/50 aria-disabled:hover:bg-transparent"
              >
                <ChevronUp className="size-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Previous <span className="ml-2 opacity-60">Shift+Enter</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Next result"
                aria-disabled={!hasHits || undefined}
                onClick={() => stepSearch(id, 1)}
                className="inline-flex size-7 items-center justify-center rounded-md text-foreground/70 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 aria-disabled:text-muted-foreground/50 aria-disabled:hover:bg-transparent"
              >
                <ChevronDown className="size-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Next <span className="ml-2 opacity-60">Enter</span>
            </TooltipContent>
          </Tooltip>
        </div>
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {statusText(tab)}
        </p>
        {!tab.hasTextLayer && (
          <p className="rounded-md bg-muted px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
            This document has no text to search: its pages are images. It needs text recognition
            (OCR) first.
          </p>
        )}
        {search.truncated && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Only the first {search.hits.length.toLocaleString()} results are shown. Refine the
            search to see the rest.
          </p>
        )}
      </div>
      <VirtualList
        items={rows}
        itemHeight={rowHeight}
        itemKey={rowKey}
        revealIndex={activeRow >= 0 ? activeRow : null}
        aria-label="Search results"
        className="py-1"
      >
        {renderRow}
      </VirtualList>
    </div>
  )
}
