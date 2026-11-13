import { useState } from 'react'
import { ImageIcon } from 'lucide-react'
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
  type WatermarkOptions,
  type WatermarkPosition
} from '@/api/engine'
import { showToolDialog, useDialogs } from '@/state/dialogs'
import { mutate } from '@/state/edits'
import { baseName } from '@/state/pageOps'
import { commitPending } from '@/state/pending'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { ColorPicker, PagesPicker, PreviewPane } from './toolParts'
import { chosenPages, usePreview, type PagesChoice } from './toolOptions'

const PRESETS = ['CONFIDENTIAL', 'DRAFT', 'COPY', 'APPROVED', 'DO NOT COPY']
const POSITIONS: WatermarkPosition[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right'
]
const ROTATIONS = [0, 45, 90, -45]

interface Settings {
  kind: 'text' | 'image'
  text: string
  imagePath: string
  fontFamily: FontFamily
  bold: boolean
  fontSize: number
  color: string
  opacity: number
  rotation: number
  position: WatermarkPosition
  scale: number
  layer: 'over' | 'under'
}

/** Remembered while the app runs, so the next watermark starts from the last one. */
let remembered: Settings = {
  kind: 'text',
  text: 'CONFIDENTIAL',
  imagePath: '',
  fontFamily: 'sans',
  bold: true,
  fontSize: 72,
  color: '#d32f2f',
  opacity: 0.3,
  rotation: 45,
  position: 'center',
  scale: 0.5,
  layer: 'over'
}

function optionsOf(settings: Settings): WatermarkOptions {
  const common = {
    opacity: settings.opacity,
    rotation: settings.rotation,
    position: settings.position,
    layer: settings.layer
  }
  return settings.kind === 'text'
    ? {
        kind: 'text',
        text: settings.text,
        fontFamily: settings.fontFamily,
        bold: settings.bold,
        fontSize: settings.fontSize,
        color: settings.color,
        ...common
      }
    : { kind: 'image', imagePath: settings.imagePath, scale: settings.scale, ...common }
}

function WatermarkForm({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(remembered)
  const [pages, setPages] = useState<PagesChoice>({ scope: 'all', range: '' })
  const [busy, setBusy] = useState(false)
  const update = (patch: Partial<Settings>): void =>
    setSettings((current) => ({ ...current, ...patch }))

  const ready = settings.kind === 'text' ? settings.text.trim() !== '' : settings.imagePath !== ''
  const chosen = chosenPages(pages, tab)
  const options = optionsOf(settings)
  const preview = usePreview(tab, JSON.stringify(options), ready, (scale, signal) =>
    engine.previewWatermark(tab.docId, options, tab.page, scale, signal)
  )

  const apply = async (): Promise<void> => {
    if (!ready || !chosen.ok) return
    setBusy(true)
    remembered = settings
    await commitPending()
    const result = await mutate(
      tab.id,
      (docId) =>
        engine.addWatermark(docId, {
          ...options,
          ...(chosen.pages ? { pages: chosen.pages } : {})
        }),
      'Could not add the watermark'
    )
    setBusy(false)
    if (result) showToolDialog('watermarkTabId', null)
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void apply()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Watermark</DialogTitle>
        <DialogDescription>
          Text or a picture drawn on every chosen page. Undo removes it.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-[1fr_auto] gap-5">
        <div className="grid content-start gap-3.5 text-xs">
          <div className="flex gap-4 text-[13px]">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="wm-kind"
                checked={settings.kind === 'text'}
                onChange={() => update({ kind: 'text' })}
              />
              Text
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="wm-kind"
                checked={settings.kind === 'image'}
                onChange={() => update({ kind: 'image' })}
              />
              Picture
            </label>
          </div>

          {settings.kind === 'text' ? (
            <>
              <Input
                value={settings.text}
                maxLength={500}
                onChange={(event) => update({ text: event.target.value })}
                className="h-8 select-text"
                aria-label="Watermark text"
              />
              <div className="flex flex-wrap gap-1">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => update({ text: preset })}
                  >
                    {preset}
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
                    min={6}
                    max={500}
                    value={settings.fontSize}
                    onChange={(event) =>
                      update({ fontSize: Math.max(1, Number(event.target.value) || 1) })
                    }
                    className="h-7 w-16 select-text"
                  />
                  pt
                </label>
              </div>
              <ColorPicker
                value={settings.color}
                onChange={(color) => update({ color })}
                label="Text colour"
              />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const [path] = await window.api.files.choose(
                      'image',
                      'Choose Watermark Picture'
                    )
                    if (path) update({ imagePath: path })
                  }}
                >
                  <ImageIcon className="size-4" aria-hidden /> Choose picture…
                </Button>
                <span className="min-w-0 truncate text-muted-foreground" title={settings.imagePath}>
                  {settings.imagePath ? baseName(settings.imagePath) : 'PNG or JPEG'}
                </span>
              </div>
              <label className="flex items-center gap-2">
                Width
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(settings.scale * 100)}
                  onChange={(event) => update({ scale: Number(event.target.value) / 100 })}
                />
                <span className="w-16 tabular-nums">
                  {Math.round(settings.scale * 100)}% of page
                </span>
              </label>
            </>
          )}

          <label className="flex items-center gap-2">
            Opacity
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round(settings.opacity * 100)}
              onChange={(event) => update({ opacity: Number(event.target.value) / 100 })}
            />
            <span className="w-9 tabular-nums">{Math.round(settings.opacity * 100)}%</span>
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            Rotation
            {ROTATIONS.map((angle) => (
              <Button
                key={angle}
                type="button"
                size="xs"
                variant={settings.rotation === angle ? 'default' : 'outline'}
                onClick={() => update({ rotation: angle })}
              >
                {angle}°
              </Button>
            ))}
            <Input
              type="number"
              min={-360}
              max={360}
              value={settings.rotation}
              onChange={(event) => update({ rotation: Number(event.target.value) || 0 })}
              className="h-6 w-16 select-text text-xs"
              aria-label="Rotation in degrees"
            />
          </div>

          <div className="flex items-start gap-4">
            <div>
              <span className="mb-1 block">Position</span>
              <div
                className="grid w-fit grid-cols-3 gap-0.5"
                role="radiogroup"
                aria-label="Position"
              >
                {POSITIONS.map((position) => (
                  <button
                    key={position}
                    type="button"
                    role="radio"
                    aria-checked={settings.position === position}
                    aria-label={position}
                    title={position}
                    onClick={() => update({ position })}
                    className="size-5 rounded-xs border bg-background aria-checked:border-primary aria-checked:bg-primary"
                  />
                ))}
              </div>
            </div>
            <fieldset>
              <legend className="mb-1">Layer</legend>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="wm-layer"
                  checked={settings.layer === 'over'}
                  onChange={() => update({ layer: 'over' })}
                />
                Over the content
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="wm-layer"
                  checked={settings.layer === 'under'}
                  onChange={() => update({ layer: 'under' })}
                />
                Behind the content
              </label>
            </fieldset>
          </div>

          <PagesPicker value={pages} onChange={setPages} tab={tab} name="wm-pages" />
        </div>

        <PreviewPane {...preview} page={tab.page} />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => showToolDialog('watermarkTabId', null)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready || !chosen.ok || busy}>
          {busy ? 'Adding…' : 'Add watermark'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function WatermarkDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.watermarkTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => !open && showToolDialog('watermarkTabId', null)}
    >
      <DialogContent className="sm:max-w-3xl">
        {tab && <WatermarkForm key={tab.id} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
