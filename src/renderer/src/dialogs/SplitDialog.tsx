import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
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
import type { SplitRequest, WrittenFile } from '@/api/engine'
import { parsePageGroups } from '@/lib/pageRanges'
import { confirmAction, showToolDialog, useDialogs } from '@/state/dialogs'
import { openPath } from '@/state/documents'
import { folderOf, splitDocument } from '@/state/pageOps'
import { useTabs, type DocumentTab } from '@/state/tabs'

type Mode = SplitRequest['mode']

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function SplitForm({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const hasBookmarks = (tab.outline ?? []).some((entry) => entry.level === 1 && entry.page !== null)
  const [mode, setMode] = useState<Mode>('every')
  const [ranges, setRanges] = useState('')
  const [every, setEvery] = useState('1')
  const [folder, setFolder] = useState(folderOf(tab.filePath))
  const [pattern, setPattern] = useState('{name}-{n}')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [written, setWritten] = useState<WrittenFile[] | null>(null)

  const groups = parsePageGroups(ranges, tab.pageCount)
  const n = Number.parseInt(every, 10)
  const request: SplitRequest | null =
    mode === 'ranges'
      ? groups.ok
        ? { mode: 'ranges', ranges: groups.groups }
        : null
      : mode === 'every'
        ? Number.isFinite(n) && n >= 1
          ? { mode: 'every', n }
          : null
        : hasBookmarks
          ? { mode: 'bookmarks' }
          : null
  const parts =
    request?.mode === 'ranges'
      ? request.ranges.length
      : request?.mode === 'every'
        ? Math.ceil(tab.pageCount / request.n)
        : null

  const close = (): void => showToolDialog('splitTabId', null)

  const run = async (): Promise<void> => {
    if (!request) return
    setBusy(true)
    setError(null)
    try {
      const result = await splitDocument(tab.id, request, folder, pattern, (paths) =>
        confirmAction({
          title: 'Replace existing files?',
          message: `${paths.length === 1 ? 'This file exists' : `These ${paths.length} files exist`} in the folder already.`,
          details: paths,
          confirmLabel: 'Replace',
          destructive: true
        })
      )
      if (result) setWritten(result.files)
    } catch (caught) {
      setError(describe(caught))
    } finally {
      setBusy(false)
    }
  }

  if (written) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle className="text-base">Document split</DialogTitle>
          <DialogDescription>
            {written.length} file{written.length === 1 ? '' : 's'} written to {folder}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 overflow-auto rounded-md border text-xs">
          {written.map((file) => (
            <li
              key={file.path}
              className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate" title={file.path}>
                {file.fileName}
              </span>
              <span className="text-muted-foreground tabular-nums">{file.pageCount} p.</span>
              <Button variant="ghost" size="xs" onClick={() => void openPath(file.path)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => written[0] && window.api.files.showInFolder(written[0].path)}
          >
            Show in folder
          </Button>
          <Button size="sm" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </div>
    )
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
        <DialogTitle className="text-base">Split Document</DialogTitle>
        <DialogDescription>
          Writes parts of {tab.fileName} as separate files, including unsaved changes. The document
          itself is not changed.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-2.5 text-[13px]">
        <legend className="mb-1.5 font-medium">Split</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="split-mode"
            checked={mode === 'every'}
            onChange={() => setMode('every')}
          />
          Every
          <Input
            type="number"
            min={1}
            max={tab.pageCount}
            value={every}
            onChange={(event) => {
              setEvery(event.target.value)
              setMode('every')
            }}
            className="h-7 w-20 select-text"
            aria-label="Pages per file"
          />
          pages
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="split-mode"
            checked={mode === 'ranges'}
            onChange={() => setMode('ranges')}
          />
          By ranges, one file each:
          <Input
            value={ranges}
            placeholder="1-3, 4-9, 10-"
            onChange={(event) => {
              setRanges(event.target.value)
              setMode('ranges')
            }}
            className="h-7 flex-1 select-text"
            aria-label="Page ranges"
          />
        </label>
        {mode === 'ranges' && ranges.trim() !== '' && !groups.ok && (
          <p className="pl-6 text-xs text-destructive">{groups.error}</p>
        )}
        <label className={`flex items-center gap-2 ${hasBookmarks ? '' : 'opacity-50'}`}>
          <input
            type="radio"
            name="split-mode"
            disabled={!hasBookmarks}
            checked={mode === 'bookmarks'}
            onChange={() => setMode('bookmarks')}
          />
          At each top-level bookmark
          {!hasBookmarks && (
            <span className="text-xs text-muted-foreground">(this document has none)</span>
          )}
        </label>
      </fieldset>

      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">Folder</span>
        <div className="flex gap-2">
          <Input
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            className="h-8 select-text text-xs"
            aria-label="Folder"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              const chosen = await window.api.files.chooseFolder(folder, 'Folder for the parts')
              if (chosen) setFolder(chosen)
            }}
          >
            <FolderOpen className="size-4" aria-hidden /> Choose…
          </Button>
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="split-pattern" className="text-[13px] font-medium">
          File names
        </label>
        <Input
          id="split-pattern"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          className="h-8 select-text"
        />
        <p className="text-xs text-muted-foreground">
          {'{name}'} document name · {'{n}'} part number · {'{start}'}/{'{end}'} first and last page
          · {'{title}'} bookmark title
        </p>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter className="items-center">
        <span className="mr-auto text-xs text-muted-foreground">
          {parts !== null ? `${parts} file${parts === 1 ? '' : 's'}` : ''}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!request || busy || folder.trim() === '' || pattern.trim() === ''}
        >
          {busy ? 'Splitting…' : 'Split'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function SplitDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.splitTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => !open && showToolDialog('splitTabId', null)}
    >
      <DialogContent className="sm:max-w-lg">
        {tab && <SplitForm key={tab.id} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
