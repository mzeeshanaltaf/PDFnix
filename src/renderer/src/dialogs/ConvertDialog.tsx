import { useState } from 'react'
import { FolderOpen, ScanText } from 'lucide-react'
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
import { showConvert, showToolDialog, useDialogs, type ConvertKind } from '@/state/dialogs'
import { folderOf } from '@/state/pageOps'
import { convertToImages, convertToText, convertToWord } from '@/state/processing'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { PagesPicker } from './toolParts'
import { chosenPages, type PagesChoice } from './toolOptions'

const KINDS: { id: ConvertKind; label: string }[] = [
  { id: 'word', label: 'Word' },
  { id: 'images', label: 'Images' },
  { id: 'text', label: 'Text' }
]

const RESOLUTIONS = [72, 96, 150, 200, 300, 600]

function ConvertForm({ tab, kind }: { tab: DocumentTab; kind: ConvertKind }): React.JSX.Element {
  const [pages, setPages] = useState<PagesChoice>({ scope: 'all', range: '' })
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [dpi, setDpi] = useState(150)
  const [folder, setFolder] = useState(folderOf(tab.filePath))
  const [layout, setLayout] = useState(true)
  const [busy, setBusy] = useState(false)
  const choice = chosenPages(pages, tab)
  const close = (): void => showConvert(null)

  const run = async (): Promise<void> => {
    if (!choice.ok) return
    const selected = choice.pages
    if (kind === 'images') {
      // The dialog stays open if the user declines to replace files.
      setBusy(true)
      try {
        const done = await convertToImages(tab.id, {
          ...(selected ? { pages: selected } : {}),
          format,
          dpi,
          outDir: folder
        })
        if (done) close()
      } finally {
        setBusy(false)
      }
      return
    }
    close()
    if (kind === 'word') await convertToWord(tab.id, selected)
    else await convertToText(tab.id, selected, layout)
  }

  const pixels = (() => {
    const page = tab.pages[tab.page]
    // MuPDF rounds the page's edges outwards.
    return `${Math.ceil((page.width * dpi) / 72 - 1e-6)} × ${Math.ceil((page.height * dpi) / 72 - 1e-6)} pixels`
  })()

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void run()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Convert PDF</DialogTitle>
        <DialogDescription>
          Writes {tab.fileName} (with unsaved changes) to a new file. The document itself is not
          changed.
        </DialogDescription>
      </DialogHeader>

      <div className="flex gap-1 rounded-md bg-muted p-1" role="tablist" aria-label="Convert to">
        {KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={kind === item.id}
            onClick={() => showConvert(tab.id, item.id)}
            className="flex-1 rounded px-3 py-1 text-[13px] aria-selected:bg-background aria-selected:shadow-sm"
          >
            {item.label}
          </button>
        ))}
      </div>

      <PagesPicker value={pages} onChange={setPages} tab={tab} name="convert-pages" />

      {kind === 'word' && (
        <div className="grid gap-2 text-xs leading-relaxed text-muted-foreground">
          {!tab.hasTextLayer && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-foreground">
              <ScanText className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="grid gap-1.5">
                <span>
                  This document has no text, only pictures of pages: the Word document would hold
                  pictures too. Recognise the text first to get editable text.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="justify-self-start"
                  onClick={() => {
                    close()
                    showToolDialog('ocrTabId', tab.id)
                  }}
                >
                  Recognise Text (OCR)…
                </Button>
              </div>
            </div>
          )}
          <p>
            Text, headings, simple tables and pictures convert well. Complex layouts (several
            columns, text over pictures, designed pages) will need tidying up in Word.
          </p>
        </div>
      )}

      {kind === 'images' && (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <fieldset className="flex items-center gap-3">
              <legend className="sr-only">Format</legend>
              {(['png', 'jpg'] as const).map((value) => (
                <label key={value} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="convert-format"
                    checked={format === value}
                    onChange={() => setFormat(value)}
                  />
                  {value === 'png' ? 'PNG (sharp, larger)' : 'JPEG (smaller)'}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2">
              Resolution
              <select
                value={dpi}
                onChange={(event) => setDpi(Number(event.target.value))}
                className="h-7 rounded-md border bg-background px-2 text-xs"
              >
                {RESOLUTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} dpi
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Page {tab.page + 1} becomes {pixels}. Files are named after the document and page
            number.
          </p>
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
                  const chosen = await window.api.files.chooseFolder(
                    folder,
                    'Folder for the images'
                  )
                  if (chosen) setFolder(chosen)
                }}
              >
                <FolderOpen aria-hidden /> Choose…
              </Button>
            </div>
          </div>
        </>
      )}

      {kind === 'text' && (
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={layout}
            onChange={(event) => setLayout(event.target.checked)}
          />
          <span>
            Follow the page layout
            <span className="block text-xs text-muted-foreground">
              Orders text top to bottom, left to right, as it appears. Untick to keep the order in
              which it is stored, which can be better for some documents.
            </span>
          </span>
        </label>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!choice.ok || busy || (kind === 'images' && folder.trim() === '')}
        >
          {kind === 'images' ? 'Export' : 'Convert…'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ConvertDialog(): React.JSX.Element {
  const convert = useDialogs((state) => state.convert)
  const tab = useTabs(
    (state) => state.tabs.find((candidate) => candidate.id === convert?.tabId) ?? null
  )
  return (
    <Dialog
      open={tab !== null && convert !== null}
      onOpenChange={(open) => !open && showConvert(null)}
    >
      <DialogContent className="sm:max-w-lg">
        {tab && convert && <ConvertForm key={tab.id} tab={tab} kind={convert.kind} />}
      </DialogContent>
    </Dialog>
  )
}
