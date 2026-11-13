import { useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react'
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
import { parsePageRanges } from '@/lib/pageRanges'
import { showMerge, useDialogs } from '@/state/dialogs'
import { announceWritten, baseName, folderOf, joinPath, mergeFiles } from '@/state/pageOps'
import { findTabByPath, getActiveTab, useTabs } from '@/state/tabs'

interface Item {
  key: number
  path: string
  /** Typed page ranges; empty for all pages. */
  pages: string
}

/** Pages are checked by the engine against each file; here only the form. */
const ANY_COUNT = 100000

let nextKey = 1

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function MergeForm(): React.JSX.Element {
  const [items, setItems] = useState<Item[]>(() => {
    const tab = getActiveTab()
    return tab ? [{ key: nextKey++, path: tab.filePath, pages: '' }] : []
  })
  const [dragging, setDragging] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tabs = useTabs((state) => state.tabs)

  const add = async (): Promise<void> => {
    const paths = await window.api.files.choose('pdfs', 'Add Files to Merge')
    if (paths.length > 0) {
      setItems((current) => [
        ...current,
        ...paths.map((path) => ({ key: nextKey++, path, pages: '' }))
      ])
    }
  }

  const moveItem = (from: number, to: number): void => {
    setItems((current) => {
      if (to < 0 || to >= current.length || from === to) return current
      const next = current.slice()
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const parsed = items.map((item) =>
    item.pages.trim() === '' ? null : parsePageRanges(item.pages, ANY_COUNT)
  )
  const invalid = parsed.some((result) => result !== null && !result.ok)
  // Merging reads the files on disk; unsaved changes in open tabs are left out.
  const unsaved = items
    .map((item) => findTabByPath(tabs, item.path))
    .filter((tab) => tab?.history.modified)
    .map((tab) => tab!.fileName)

  const run = async (): Promise<void> => {
    const first = items[0]
    if (!first) return
    const suggested = joinPath(folderOf(first.path), 'Merged.pdf')
    const target = await window.api.files.showSaveDialog(suggested, 'Save Merged File')
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      const written = await mergeFiles(
        items.map((item, index) => {
          const result = parsed[index]
          return { path: item.path, pages: result && result.ok ? result.pages : undefined }
        }),
        target
      )
      if (written) {
        showMerge(false)
        announceWritten(written, `Merged ${items.length} files (${written.pageCount} pages)`)
      }
    } catch (caught) {
      setError(describe(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void run()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Merge Files</DialogTitle>
        <DialogDescription>
          Combines PDF files, in this order, into a new file. Drag to reorder; leave Pages empty to
          take every page.
        </DialogDescription>
      </DialogHeader>

      <ol className="grid max-h-80 gap-1 overflow-auto" aria-label="Files to merge">
        {items.length === 0 && (
          <li className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            No files yet. Add the PDFs to combine.
          </li>
        )}
        {items.map((item, index) => {
          const result = parsed[index]
          return (
            <li
              key={item.key}
              draggable
              onDragStart={(event) => {
                setDragging(index)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-pdfnix-merge', String(index))
              }}
              onDragOver={(event) => {
                if (dragging === null) return
                event.preventDefault()
                event.stopPropagation()
              }}
              onDrop={(event) => {
                if (dragging === null) return
                event.preventDefault()
                event.stopPropagation()
                moveItem(dragging, index)
                setDragging(null)
              }}
              onDragEnd={() => setDragging(null)}
              className={`flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 ${dragging === index ? 'opacity-50' : ''}`}
            >
              <GripVertical
                className="size-4 shrink-0 cursor-grab text-muted-foreground"
                aria-hidden
              />
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]" title={item.path}>
                {baseName(item.path)}
              </span>
              <Input
                value={item.pages}
                placeholder="All pages"
                aria-label={`Pages of ${baseName(item.path)}`}
                aria-invalid={result !== null && !result.ok}
                title={result && !result.ok ? result.error : 'For example 1-3, 7'}
                onChange={(event) =>
                  setItems((current) =>
                    current.map((candidate) =>
                      candidate.key === item.key
                        ? { ...candidate, pages: event.target.value }
                        : candidate
                    )
                  )
                }
                className="h-7 w-28 select-text text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => moveItem(index, index - 1)}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Move down"
                disabled={index === items.length - 1}
                onClick={() => moveItem(index, index + 1)}
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Remove ${baseName(item.path)}`}
                onClick={() =>
                  setItems((current) => current.filter((candidate) => candidate.key !== item.key))
                }
              >
                <X className="size-3.5" />
              </Button>
            </li>
          )
        })}
      </ol>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => void add()}>
          <Plus className="size-4" aria-hidden /> Add files…
        </Button>
      </div>

      {unsaved.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Unsaved changes in {unsaved.join(', ')} are not included: merging uses the saved files.
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => showMerge(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={items.length < 2 || invalid || busy}>
          {busy ? 'Merging…' : 'Merge…'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function MergeDialog(): React.JSX.Element {
  const open = useDialogs((state) => state.mergeOpen)
  return (
    <Dialog open={open} onOpenChange={(value) => showMerge(value)}>
      <DialogContent className="sm:max-w-xl">{open && <MergeForm />}</DialogContent>
    </Dialog>
  )
}
