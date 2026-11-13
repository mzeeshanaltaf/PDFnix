import { useState } from 'react'
import { MousePointerSquareDashed, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { RedactionMark } from '@/api/engine'
import { parsePageRanges } from '@/lib/pageRanges'
import { showToolDialog, useDialogs } from '@/state/dialogs'
import {
  applyMarks,
  removeAllMarks,
  removeMark,
  searchAndMark,
  useRedactionMarks,
  useRedactOptions
} from '@/state/redaction'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { useTools } from '@/state/tools'
import { getViewer } from '@/viewer/controller'

const FILLS: { value: string | null; label: string }[] = [
  { value: '#000000', label: 'Black' },
  { value: '#ffffff', label: 'White' },
  { value: '#7f1d1d', label: 'Dark red' },
  { value: null, label: 'No fill' }
]

function MarkRow({ tab, mark }: { tab: DocumentTab; mark: RedactionMark }): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 border-b px-2 py-1 last:border-b-0">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs hover:underline"
        onClick={() => getViewer(tab.id)?.goToPage(mark.page)}
        title="Show this page"
      >
        <span className="w-12 shrink-0 text-muted-foreground tabular-nums">p. {mark.page + 1}</span>
        <span className="min-w-0 flex-1 truncate">
          {mark.kind === 'annotation' ? (
            <span className="italic">Comment: {mark.text || '(empty)'}</span>
          ) : mark.text ? (
            mark.text
          ) : (
            <span className="text-muted-foreground italic">Area without text</span>
          )}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={`Remove the mark on page ${mark.page + 1}`}
        onClick={() => void removeMark(tab.id, mark.annotId)}
      >
        <X className="size-3.5" />
      </Button>
    </li>
  )
}

function RedactPanel({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const marks = useRedactionMarks(tab.id)
  const options = useRedactOptions()
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [scope, setScope] = useState<'all' | 'range'>('all')
  const [range, setRange] = useState('')
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState<string | null>(null)
  const [cleanMetadata, setCleanMetadata] = useState(true)

  const parsedRange = scope === 'range' ? parsePageRanges(range, tab.pageCount) : null
  const close = (): void => showToolDialog('redactTabId', null)

  const search = async (): Promise<void> => {
    if (!query.trim()) return
    if (parsedRange && !parsedRange.ok) return
    setSearching(true)
    const count = await searchAndMark(tab.id, query, {
      matchCase,
      wholeWord,
      ...(parsedRange?.ok ? { pages: parsedRange.pages } : {})
    })
    setSearching(false)
    if (count !== null) {
      setFound(
        count === 0
          ? `No matches for “${query.trim()}”.`
          : `${count} match${count === 1 ? '' : 'es'} marked.`
      )
    }
  }

  const count = marks?.length ?? 0

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-base">Redact</DialogTitle>
        <DialogDescription>
          Mark what must go, review the marks, then apply them. Marks are outlined in red and remove
          nothing until applied.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <span className="text-[13px] font-medium">New marks</span>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">Fill</span>
          {FILLS.map((fill) => (
            <button
              key={fill.label}
              type="button"
              title={fill.label}
              aria-label={fill.label}
              aria-pressed={options.fill === fill.value}
              onClick={() => options.setFill(fill.value)}
              className="size-6 rounded-full ring-1 ring-black/20 outline-offset-2 aria-pressed:outline-2 aria-pressed:outline-primary"
              style={fill.value ? { background: fill.value } : undefined}
            >
              {fill.value === null && <span className="pdf-no-fill mx-auto" />}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2">
            <span className="text-muted-foreground">Overlay text</span>
            <Input
              value={options.overlayText}
              placeholder="none"
              maxLength={200}
              onChange={(event) => options.setOverlayText(event.target.value)}
              className="h-7 w-36 select-text text-xs"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              close()
              useTools.getState().setActiveTool('redact')
            }}
          >
            <MousePointerSquareDashed className="size-4" aria-hidden /> Mark areas on the page
          </Button>
          <span className="text-xs text-muted-foreground">or select text and press R</span>
        </div>
      </div>

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label htmlFor="redact-query" className="text-[13px] font-medium">
          Find and mark
        </label>
        <div className="flex gap-2">
          <Input
            id="redact-query"
            value={query}
            placeholder="Name, number, phrase…"
            onChange={(event) => {
              setQuery(event.target.value)
              setFound(null)
            }}
            className="h-8 select-text"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!query.trim() || searching || (parsedRange !== null && !parsedRange.ok)}
          >
            <Search className="size-4" aria-hidden /> {searching ? 'Marking…' : 'Mark all'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(event) => setMatchCase(event.target.checked)}
            />
            Match case
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(event) => setWholeWord(event.target.checked)}
            />
            Whole words
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="redact-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            All pages
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="redact-scope"
              checked={scope === 'range'}
              onChange={() => setScope('range')}
            />
            Pages
            <Input
              value={range}
              placeholder="1-3, 7"
              onChange={(event) => {
                setRange(event.target.value)
                setScope('range')
              }}
              className="h-6 w-24 select-text text-xs"
              aria-label="Pages to search"
            />
          </label>
        </div>
        {parsedRange && !parsedRange.ok && range.trim() !== '' && (
          <p className="text-xs text-destructive">{parsedRange.error}</p>
        )}
        {found && <p className="text-xs text-muted-foreground">{found}</p>}
        <p className="text-[11px] text-muted-foreground">
          Search also finds hidden text (such as a scan’s recognised text) and comments that mention
          it.
        </p>
      </form>

      <div className="grid gap-1.5">
        <div className="flex items-center">
          <span className="text-[13px] font-medium">
            Marks {marks !== null && <span className="text-muted-foreground">({count})</span>}
          </span>
          {count > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto"
              onClick={() => marks && void removeAllMarks(tab.id, marks)}
            >
              Remove all
            </Button>
          )}
        </div>
        <ul
          className="max-h-48 min-h-12 overflow-auto rounded-md border"
          aria-label="Redaction marks"
        >
          {marks === null ? (
            <li className="px-3 py-3 text-xs text-muted-foreground">Loading…</li>
          ) : count === 0 ? (
            <li className="px-3 py-3 text-xs text-muted-foreground">No marks yet.</li>
          ) : (
            marks.map((mark) => <MarkRow key={mark.annotId} tab={tab} mark={mark} />)
          )}
        </ul>
      </div>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={cleanMetadata}
          onChange={(event) => setCleanMetadata(event.target.checked)}
        />
        <span>
          Also remove the document’s properties (title, author, subject, keywords) and hidden XMP
          metadata, which can repeat redacted text.
        </span>
      </label>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={close}>
          Close
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={count === 0}
          onClick={async () => {
            if (await applyMarks(tab.id, count, cleanMetadata)) close()
          }}
        >
          Apply {count > 0 ? count : ''} redaction{count === 1 ? '' : 's'}…
        </Button>
      </DialogFooter>
    </div>
  )
}

export function RedactDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.redactTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => !open && showToolDialog('redactTabId', null)}
    >
      <DialogContent className="sm:max-w-xl">
        {tab && <RedactPanel key={tab.id} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
