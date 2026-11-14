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
import { Input } from '@/components/ui/input'
import type { PrinterInfo, PrintRequest } from '../../../shared/api'
import { printerPageRanges } from '@/lib/pageRanges'
import { showToolDialog, useDialogs } from '@/state/dialogs'
import { printDocument } from '@/state/processing'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { PagesPicker } from './toolParts'
import { chosenPages, type PagesChoice } from './toolOptions'

type Orientation = 'auto' | 'portrait' | 'landscape'
type Side = NonNullable<PrintRequest['side']>

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className="grid gap-1 text-[13px]">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function PrintForm({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null)
  const [printerError, setPrinterError] = useState<string | null>(null)
  const [printer, setPrinter] = useState('')
  const [pages, setPages] = useState<PagesChoice>({ scope: 'all', range: '' })
  const [copies, setCopies] = useState('1')
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [scale, setScale] = useState<PrintRequest['scale']>('fit')
  const [color, setColor] = useState<'color' | 'mono'>('color')
  const [side, setSide] = useState<Side>('simplex')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    window.api.print
      .printers()
      .then((list) => {
        if (!live) return
        setPrinters(list)
        setPrinter(
          (current) => current || (list.find((item) => item.isDefault) ?? list[0])?.name || ''
        )
      })
      .catch((caught: unknown) => live && setPrinterError(String(caught)))
    return () => {
      live = false
    }
  }, [])

  const chosen = printers?.find((item) => item.name === printer) ?? null
  const choice = chosenPages(pages, tab)
  const count = Number.parseInt(copies, 10)
  const copiesOk = Number.isInteger(count) && count >= 1 && count <= 999
  const close = (): void => showToolDialog('printTabId', null)

  const run = async (): Promise<void> => {
    if (!chosen || !choice.ok || !copiesOk) return
    setBusy(true)
    const done = await printDocument(tab.id, {
      printer: chosen.name,
      ...(choice.pages ? { pages: printerPageRanges(choice.pages) } : {}),
      copies: count,
      ...(orientation !== 'auto' ? { orientation } : {}),
      scale,
      monochrome: color === 'mono',
      ...(chosen.duplex ? { side } : {})
    })
    setBusy(false)
    if (done) close()
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
        <DialogTitle className="text-base">Print</DialogTitle>
        <DialogDescription>
          Prints {tab.fileName} as it is now, with unsaved changes.
        </DialogDescription>
      </DialogHeader>

      <label className="grid gap-1 text-[13px]">
        Printer
        <select
          value={printer}
          onChange={(event) => setPrinter(event.target.value)}
          disabled={!printers || printers.length === 0}
          className="h-8 rounded-md border bg-background px-2 text-[13px]"
        >
          {printers === null && (
            <option value="">{printerError ? 'Unavailable' : 'Looking for printers…'}</option>
          )}
          {printers?.length === 0 && <option value="">No printers installed</option>}
          {printers?.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
              {item.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
      {printerError && <p className="-mt-2 text-xs text-destructive">{printerError}</p>}

      <PagesPicker value={pages} onChange={setPages} tab={tab} name="print-pages" />

      <div className="grid grid-cols-3 gap-3">
        <label className="grid gap-1 text-[13px]">
          Copies
          <Input
            type="number"
            min={1}
            max={999}
            value={copies}
            onChange={(event) => setCopies(event.target.value)}
            className="h-8 select-text text-xs"
          />
        </label>
        <Select
          label="Orientation"
          value={orientation}
          onChange={setOrientation}
          options={[
            { value: 'auto', label: 'As the pages' },
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' }
          ]}
        />
        <Select
          label="Size"
          value={scale}
          onChange={setScale}
          options={[
            { value: 'fit', label: 'Fit to paper' },
            { value: 'shrink', label: 'Shrink if too large' },
            { value: 'noscale', label: 'Actual size' }
          ]}
        />
        <Select
          label="Colour"
          value={color}
          onChange={setColor}
          options={[
            { value: 'color', label: 'Colour' },
            { value: 'mono', label: 'Black and white' }
          ]}
        />
        <Select
          label="Sides"
          value={chosen?.duplex ? side : 'simplex'}
          onChange={setSide}
          disabled={!chosen?.duplex}
          options={[
            { value: 'simplex', label: 'One side' },
            { value: 'duplexlong', label: 'Both sides (long edge)' },
            { value: 'duplexshort', label: 'Both sides (short edge)' }
          ]}
        />
      </div>
      {chosen && !chosen.duplex && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {chosen.name} does not report two-sided printing.
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!chosen || !choice.ok || !copiesOk || busy}>
          {busy ? 'Printing…' : 'Print'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function PrintDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.printTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => !open && showToolDialog('printTabId', null)}
    >
      <DialogContent className="sm:max-w-lg">
        {tab && <PrintForm key={tab.id} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
