import { useState } from 'react'
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
import {
  engine,
  type FontFamily,
  type HeaderFooterOptions,
  type HeaderFooterTexts
} from '@/api/engine'
import { showToolDialog, useDialogs } from '@/state/dialogs'
import { mutate } from '@/state/edits'
import { commitPending } from '@/state/pending'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { ColorPicker, PagesPicker, PreviewPane } from './toolParts'
import { chosenPages, usePreview, type PagesChoice } from './toolOptions'

type Slot = keyof HeaderFooterTexts

interface Settings {
  header: HeaderFooterTexts
  footer: HeaderFooterTexts
  fontFamily: FontFamily
  bold: boolean
  fontSize: number
  color: string
  margins: { top: number; bottom: number; left: number; right: number }
  startNumber: number
}

const EMPTY: HeaderFooterTexts = { left: '', center: '', right: '' }

let remembered: Settings = {
  header: EMPTY,
  footer: { left: '', center: 'Page {page} of {pages}', right: '' },
  fontFamily: 'sans',
  bold: false,
  fontSize: 10,
  color: '#000000',
  margins: { top: 36, bottom: 36, left: 54, right: 54 },
  startNumber: 1
}

const PRESETS: { label: string; apply: (settings: Settings) => Partial<Settings> }[] = [
  {
    label: 'Page X of Y',
    apply: (s) => ({ footer: { ...s.footer, center: 'Page {page} of {pages}' } })
  },
  { label: 'Page number, right', apply: (s) => ({ footer: { ...s.footer, right: '{page}' } }) },
  {
    label: 'File name and date',
    apply: (s) => ({ header: { ...s.header, left: '{filename}', right: '{date}' } })
  },
  { label: 'Clear all', apply: () => ({ header: EMPTY, footer: EMPTY }) }
]

function TextRow({
  label,
  texts,
  onChange
}: {
  label: string
  texts: HeaderFooterTexts
  onChange: (texts: HeaderFooterTexts) => void
}): React.JSX.Element {
  return (
    <div className="grid gap-1">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {(['left', 'center', 'right'] as Slot[]).map((slot) => (
          <Input
            key={slot}
            value={texts[slot]}
            placeholder={slot}
            maxLength={500}
            onChange={(event) => onChange({ ...texts, [slot]: event.target.value })}
            className={`h-8 select-text text-xs text-${slot === 'center' ? 'center' : slot}`}
            aria-label={`${label} ${slot}`}
          />
        ))}
      </div>
    </div>
  )
}

function HeaderFooterForm({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(remembered)
  const [pages, setPages] = useState<PagesChoice>({ scope: 'all', range: '' })
  const [busy, setBusy] = useState(false)
  const update = (patch: Partial<Settings>): void =>
    setSettings((current) => ({ ...current, ...patch }))

  const texts = [...Object.values(settings.header), ...Object.values(settings.footer)]
  const ready = texts.some((text) => text.trim() !== '')
  const chosen = chosenPages(pages, tab)
  const options: HeaderFooterOptions = {
    ...settings,
    date: new Date().toLocaleDateString(),
    ...(chosen.ok && chosen.pages ? { pages: chosen.pages } : {})
  }
  const preview = usePreview(tab, JSON.stringify(options), ready, (scale, signal) =>
    engine.previewHeaderFooter(tab.docId, options, tab.page, scale, signal)
  )

  const apply = async (): Promise<void> => {
    if (!ready || !chosen.ok) return
    setBusy(true)
    remembered = settings
    await commitPending()
    const result = await mutate(
      tab.id,
      (docId) => engine.addHeaderFooter(docId, options),
      'Could not add the header and footer'
    )
    setBusy(false)
    if (result) showToolDialog('headerFooterTabId', null)
  }

  const margin = (side: keyof Settings['margins']): React.JSX.Element => (
    <label className="flex items-center gap-1">
      {side}
      <Input
        type="number"
        min={0}
        max={400}
        value={settings.margins[side]}
        onChange={(event) =>
          update({
            margins: { ...settings.margins, [side]: Math.max(0, Number(event.target.value) || 0) }
          })
        }
        className="h-6 w-14 select-text text-xs"
      />
    </label>
  )

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void apply()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Header and Footer</DialogTitle>
        <DialogDescription>
          Text at the top and bottom of every chosen page. {'{page}'} page number · {'{pages}'} last
          number · {'{date}'} today · {'{filename}'} file name.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-[1fr_auto] gap-5">
        <div className="grid content-start gap-3.5 text-xs">
          <TextRow
            label="Header"
            texts={settings.header}
            onChange={(header) => update({ header })}
          />
          <TextRow
            label="Footer"
            texts={settings.footer}
            onChange={(footer) => update({ footer })}
          />
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => update(preset.apply(settings))}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={settings.fontFamily}
              onChange={(event) => update({ fontFamily: event.target.value as FontFamily })}
              className="h-7 rounded-md border bg-background px-1.5"
              aria-label="Font"
            >
              <option value="sans">Sans serif</option>
              <option value="serif">Serif</option>
              <option value="mono">Monospace</option>
            </select>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={settings.bold}
                onChange={(event) => update({ bold: event.target.checked })}
              />
              Bold
            </label>
            <label className="flex items-center gap-1.5">
              Size
              <Input
                type="number"
                min={4}
                max={72}
                value={settings.fontSize}
                onChange={(event) =>
                  update({ fontSize: Math.max(1, Number(event.target.value) || 1) })
                }
                className="h-7 w-14 select-text"
              />
              pt
            </label>
          </div>
          <ColorPicker
            value={settings.color}
            onChange={(color) => update({ color })}
            label="Text colour"
          />
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="mb-1">Margins (points)</legend>
            {margin('top')}
            {margin('bottom')}
            {margin('left')}
            {margin('right')}
          </fieldset>
          <label className="flex items-center gap-2">
            First page number
            <Input
              type="number"
              min={0}
              value={settings.startNumber}
              onChange={(event) =>
                update({ startNumber: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })
              }
              className="h-7 w-16 select-text"
            />
          </label>
          <PagesPicker value={pages} onChange={setPages} tab={tab} name="hf-pages" />
        </div>
        <PreviewPane {...preview} page={tab.page} />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => showToolDialog('headerFooterTabId', null)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready || !chosen.ok || busy}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function HeaderFooterDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.headerFooterTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => !open && showToolDialog('headerFooterTabId', null)}
    >
      <DialogContent className="sm:max-w-3xl">
        {tab && <HeaderFooterForm key={tab.id} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
