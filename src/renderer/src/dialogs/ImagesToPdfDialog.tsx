import { useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { showImagesToPdf, useDialogs } from '@/state/dialogs'
import { baseName } from '@/state/pageOps'
import { imagesToPdf, type ImagesToPdfOptions } from '@/state/processing'

const MARGINS = [
  { value: 0, label: 'None' },
  { value: 18, label: 'Small' },
  { value: 36, label: 'Normal' },
  { value: 72, label: 'Wide' }
]

function ImagesForm(): React.JSX.Element {
  const [files, setFiles] = useState<string[]>([])
  const [pageSize, setPageSize] = useState<ImagesToPdfOptions['pageSize']>('a4')
  const [orientation, setOrientation] = useState<ImagesToPdfOptions['orientation']>('auto')
  const [margin, setMargin] = useState(36)
  const close = (): void => showImagesToPdf(false)

  const add = async (): Promise<void> => {
    const chosen = await window.api.files.choose('images', 'Add Pictures')
    if (chosen.length > 0) setFiles([...files, ...chosen.filter((path) => !files.includes(path))])
  }

  const move = (index: number, by: -1 | 1): void => {
    const next = files.slice()
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    setFiles(next)
  }

  const run = (): void => {
    if (files.length === 0) return
    close()
    void imagesToPdf(files, { pageSize, orientation, margin })
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        run()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Images to PDF</DialogTitle>
        <DialogDescription>
          Each picture becomes a page, in this order. Photos are turned upright as they were taken.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <ul
          className="max-h-60 min-h-24 overflow-auto rounded-md border text-xs"
          aria-label="Pictures"
        >
          {files.length === 0 && (
            <li className="px-3 py-6 text-center text-muted-foreground">
              No pictures yet. PNG, JPEG, TIFF, BMP and GIF work.
            </li>
          )}
          {files.map((path, index) => (
            <li key={path} className="flex items-center gap-1 border-b px-2 py-1 last:border-b-0">
              <span className="w-6 text-right text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate px-1" title={path}>
                {baseName(path)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${baseName(path)} up`}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={index === files.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${baseName(path)} down`}
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setFiles(files.filter((item) => item !== path))}
                aria-label={`Remove ${baseName(path)}`}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => void add()}
        >
          <ImagePlus aria-hidden /> Add Pictures…
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-[13px]">
        <label className="grid gap-1">
          Page size
          <select
            value={pageSize}
            onChange={(event) => setPageSize(event.target.value as ImagesToPdfOptions['pageSize'])}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
            <option value="image">Fit each picture</option>
          </select>
        </label>
        <label className="grid gap-1">
          Orientation
          <select
            value={orientation}
            disabled={pageSize === 'image'}
            onChange={(event) =>
              setOrientation(event.target.value as ImagesToPdfOptions['orientation'])
            }
            className="h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-50"
          >
            <option value="auto">As the picture</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label className="grid gap-1">
          Margin
          <select
            value={margin}
            onChange={(event) => setMargin(Number(event.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {MARGINS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DialogFooter className="items-center">
        <span className="mr-auto text-xs text-muted-foreground">
          {files.length > 0 ? `${files.length} page${files.length === 1 ? '' : 's'}` : ''}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={files.length === 0}>
          Make PDF…
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ImagesToPdfDialog(): React.JSX.Element {
  const open = useDialogs((state) => state.imagesToPdfOpen)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && showImagesToPdf(false)}>
      <DialogContent className="sm:max-w-lg">{open && <ImagesForm />}</DialogContent>
    </Dialog>
  )
}
