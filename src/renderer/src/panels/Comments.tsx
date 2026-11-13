import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import { engine, type Annotation } from '@/api/engine'
import { changeAnnotation, deleteAnnotation, selectAnnotation } from '@/state/edits'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { getViewer } from '@/viewer/controller'
import { quadBounds } from '@/viewer/geometry'
import { COMMENT_FILTERS, groupComments, mergePages, type CommentFilter } from './commentRows'

const TYPE_LABELS: Record<string, string> = {
  note: 'Note',
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikeout'
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

/** Where to scroll to show an annotation. */
function revealRect(annotation: Annotation): [number, number, number, number] {
  const quads = annotation.quads ?? []
  if (quads.length === 0) return annotation.rect
  const boxes = quads.map(quadBounds)
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3]))
  ]
}

/**
 * Keeps the annotations of the whole document: fetched once, then page by
 * page as pages change (their revision moves on).
 */
function useAllAnnotations(tab: DocumentTab): Annotation[] | null {
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null)
  const known = useRef<{ docId: string; revisions: number[] } | null>(null)

  const { docId, pageRevisions } = tab
  useEffect(() => {
    let cancelled = false
    // `known` is what the list shows. It moves on only when a fetch lands, so
    // a fetch that is cancelled (a newer change, or React running the effect
    // twice in development) is simply made again.
    const previous = known.current
    const fresh =
      !previous || previous.docId !== docId || previous.revisions.length !== pageRevisions.length
    const changed = fresh
      ? []
      : pageRevisions.flatMap((revision, page) =>
          revision !== previous.revisions[page] ? [page] : []
        )
    if (!fresh && changed.length === 0) return

    const loading: Promise<(current: Annotation[] | null) => Annotation[]> = fresh
      ? engine.annotations(docId).then((all) => () => all)
      : Promise.all(changed.map((page) => engine.annotations(docId, page))).then(
          (lists) => (current) => mergePages(current ?? [], new Set(changed), lists.flat())
        )
    loading
      .then((apply) => {
        if (cancelled) return
        known.current = { docId, revisions: pageRevisions }
        setAnnotations(apply)
      })
      .catch(() => {
        // The pages still show the truth; the list catches up on the next change.
        if (cancelled) return
        known.current = { docId, revisions: pageRevisions }
        setAnnotations((current) => current ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [docId, pageRevisions])

  return annotations
}

function CommentItem({
  tab,
  annotation,
  selected
}: {
  tab: DocumentTab
  annotation: Annotation
  selected: boolean
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(annotation.contents)
  const target = { annotId: annotation.annotId, page: annotation.page }

  const save = (): void => {
    setEditing(false)
    if (text !== annotation.contents) void changeAnnotation(tab.id, target, { contents: text })
  }

  return (
    <li
      className={cn(
        'group rounded-md border px-2.5 py-2 text-[13px]',
        selected ? 'border-primary/60 bg-primary/6' : 'border-transparent hover:bg-accent/60'
      )}
    >
      <button
        type="button"
        className="block w-full text-left outline-none"
        onClick={() => {
          selectAnnotation(tab.id, target)
          getViewer(tab.id)?.reveal(annotation.page, revealRect(annotation))
        }}
      >
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="size-2.5 shrink-0 rounded-full ring-1 ring-black/15"
            style={{ background: annotation.color ?? 'transparent' }}
            aria-hidden
          />
          <span className="font-medium text-foreground/80">{typeLabel(annotation.type)}</span>
          <span className="min-w-0 truncate">{annotation.author}</span>
          <span className="ml-auto shrink-0">{formatDate(annotation.modifiedAt)}</span>
        </div>
        {!editing && (
          <p className="mt-1 break-words whitespace-pre-wrap text-foreground">
            {annotation.contents || <span className="text-muted-foreground italic">No text</span>}
          </p>
        )}
      </button>
      {editing ? (
        <div className="mt-1.5 grid gap-1.5">
          <textarea
            autoFocus
            value={text}
            aria-label="Comment"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setText(annotation.contents)
                setEditing(false)
              } else if (event.key === 'Enter' && event.ctrlKey) {
                save()
              }
            }}
            className="h-20 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-ring"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className="h-6 rounded-md px-2 text-xs hover:bg-accent"
              onClick={() => {
                setText(annotation.contents)
                setEditing(false)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-6 rounded-md bg-primary px-2 text-xs text-primary-foreground"
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex justify-end gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            title="Edit comment"
            aria-label="Edit comment"
            className="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent"
            onClick={() => {
              setText(annotation.contents)
              setEditing(true)
            }}
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            title="Delete"
            aria-label="Delete"
            className="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent"
            onClick={() => void deleteAnnotation(tab.id, target)}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </li>
  )
}

/** Every comment and note of the document, grouped by page. */
export function Comments({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const annotations = useAllAnnotations(tab)
  const [filter, setFilter] = useState<CommentFilter>('all')
  const selectedId = useTabs(
    (state) => state.tabs.find((candidate) => candidate.id === tab.id)?.selectedAnnotation?.annotId
  )

  const groups = annotations ? groupComments(annotations, filter) : []
  const total = groups.reduce((sum, group) => sum + group.annotations.length, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <select
          aria-label="Show"
          value={filter}
          onChange={(event) => setFilter(event.target.value as CommentFilter)}
          className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-[13px] outline-none focus:border-ring"
        >
          {COMMENT_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {annotations ? total : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {annotations === null && (
          <p className="px-1 py-2 text-[13px] text-muted-foreground">Loading…</p>
        )}
        {annotations !== null && total === 0 && (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-[13px] text-muted-foreground">
            <MessageSquare className="size-5 opacity-60" aria-hidden />
            {filter === 'all'
              ? 'No comments yet. Add a note (N) or select text and comment on it.'
              : 'Nothing of this type.'}
          </div>
        )}
        {groups.map((group) => (
          <section key={group.page} className="mb-2">
            <h3 className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Page {group.page + 1}
            </h3>
            <ul className="grid gap-1">
              {group.annotations.map((annotation) => (
                <CommentItem
                  key={annotation.annotId}
                  tab={tab}
                  annotation={annotation}
                  selected={annotation.annotId === selectedId}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
