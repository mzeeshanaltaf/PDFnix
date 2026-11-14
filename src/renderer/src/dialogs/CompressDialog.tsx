import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { engine, type CompressPreset, type CompressResult } from '@/api/engine'
import { showToolDialog, useDialogs } from '@/state/dialogs'
import { folderOf, joinPath, stemOf } from '@/state/pageOps'
import { compressDocument, openWritten } from '@/state/processing'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { formatSaving, formatSize } from './format'

const PRESETS: { id: CompressPreset; label: string; description: string }[] = [
  {
    id: 'light',
    label: 'Light',
    description: 'Re-encodes pictures at high quality and tidies the file. Looks the same.'
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description:
      'Reduces pictures to about 150 dpi, medium quality; keeps only the letters used from each font. Good for sharing.'
  },
  {
    id: 'strong',
    label: 'Strong',
    description:
      'Reduces pictures to about 96 dpi, lower quality; drops page thumbnails. Smallest; fine for reading on screen.'
  }
]

function CompressForm({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const [preset, setPreset] = useState<CompressPreset>('balanced')
  const [grayscale, setGrayscale] = useState(false)
  const [output, setOutput] = useState<'replace' | 'file'>('replace')
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CompressResult | null>(null)

  useEffect(() => {
    let live = true
    engine
      .info(tab.docId)
      .then((info) => live && setFileSize(info.fileSize))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [tab.docId])

  const close = (): void => showToolDialog('compressTabId', null)

  const run = async (): Promise<void> => {
    let outPath: string | undefined
    if (output === 'file') {
      const chosen = await window.api.files.showSaveDialog(
        joinPath(folderOf(tab.filePath), `${stemOf(tab.filePath)} (compressed).pdf`),
        'Save Compressed Copy'
      )
      if (!chosen) return
      outPath = chosen
    }
    setBusy(true)
    try {
      const answer = await compressDocument(tab.id, {
        preset,
        grayscale: preset === 'strong' && grayscale,
        output,
        ...(outPath ? { outPath } : {})
      })
      if (answer) setResult(answer)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const saving = formatSaving(result.originalSize, result.newSize)
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle className="text-base">
            {result.smaller ? 'Document compressed' : 'Already compact'}
          </DialogTitle>
          <DialogDescription>
            {result.smaller
              ? result.output === 'replace'
                ? 'The document was replaced by the compressed version. Save to keep it, or undo with Ctrl+Z.'
                : 'The compressed copy was saved. This document is unchanged.'
              : `Compressing would not make it smaller (${formatSize(result.originalSize)} now, ${formatSize(result.newSize)} compressed), so nothing was changed.`}
          </DialogDescription>
        </DialogHeader>
        {result.smaller && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm tabular-nums" role="status">
            {saving}
          </p>
        )}
        <DialogFooter>
          {result.smaller && result.output === 'file' && result.path && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => result.path && window.api.files.showInFolder(result.path)}
              >
                Show in folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (result.path) openWritten(result.path)
                  close()
                }}
              >
                Open file
              </Button>
            </>
          )}
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
        <DialogTitle className="text-base">Compress</DialogTitle>
        <DialogDescription>
          {fileSize !== null ? `${tab.fileName} is ${formatSize(fileSize)} on disk.` : tab.fileName}{' '}
          Pictures make up most of a large PDF; text-only files shrink little.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-2 text-[13px]">
        <legend className="mb-1.5 font-medium">Strength</legend>
        {PRESETS.map((item) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <input
              type="radio"
              name="compress-preset"
              className="mt-0.5"
              checked={preset === item.id}
              onChange={() => setPreset(item.id)}
            />
            <span className="grid gap-0.5">
              <span className="font-medium">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.description}</span>
              {item.id === 'strong' && (
                <span className="mt-1 flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    id="compress-gray"
                    checked={grayscale}
                    disabled={preset !== 'strong'}
                    onChange={(event) => setGrayscale(event.target.checked)}
                  />
                  <label
                    htmlFor="compress-gray"
                    className={preset !== 'strong' ? 'opacity-50' : ''}
                  >
                    Also turn colours to grey
                  </label>
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-1.5 text-[13px]">
        <legend className="mb-1 font-medium">Result</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="compress-output"
            checked={output === 'replace'}
            onChange={() => setOutput('replace')}
          />
          Replace this document (can be undone; saved with the next Save)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="compress-output"
            checked={output === 'file'}
            onChange={() => setOutput('file')}
          />
          Save a compressed copy as a new file…
        </label>
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Compressing…' : 'Compress'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CompressDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.compressTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => !open && showToolDialog('compressTabId', null)}
    >
      <DialogContent className="sm:max-w-lg">
        {tab && <CompressForm key={tab.id} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
