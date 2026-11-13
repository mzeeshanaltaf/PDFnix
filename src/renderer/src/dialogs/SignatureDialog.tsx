import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Pencil, Star, Trash2, Upload } from 'lucide-react'
import { cn } from 'cn'
import type { SignatureEntry, SignatureKind } from '../../../shared/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  addSignature,
  armSignature,
  entriesOf,
  loadSignatures,
  previewUrl,
  removeSignature,
  renameSignature,
  setDefaultSignature,
  useSignatures
} from '@/state/signatures'
import { getActiveTab } from '@/state/tabs'
import { blobToBase64, IMAGE_ACCEPT } from '@/tools/images'
import {
  cropToInk,
  DEFAULT_THRESHOLD,
  downscale,
  removeBackground,
  type Pixels
} from '@/tools/signatureImage'

/** Handwriting fonts for typed signatures (bundled, SIL Open Font License). */
const HANDWRITING = ['Great Vibes', 'Dancing Script', 'Allura', 'Sacramento'] as const
const INKS = [
  { value: '#000000', label: 'Black' },
  { value: '#1a3d8f', label: 'Blue' }
]
/** Pixels per CSS pixel the pad and type preview draw at. */
const DETAIL = 3
const PAD_HEIGHT = 160
/** Uploads are reduced to this many pixels on their longer side. */
const UPLOAD_LIMIT = 1600

async function pixelsToPng(pixels: Pixels): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  canvas
    .getContext('2d')
    ?.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The picture could not be made.')
  return blobToBase64(blob)
}

function canvasPixels(canvas: HTMLCanvasElement): Pixels | null {
  const context = canvas.getContext('2d')
  if (!context) return null
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  return { width: image.width, height: image.height, data: image.data }
}

/** What each way of making a signature hands back: a cropped PNG, or null. */
type Producer = () => Promise<string | null>

function InkPicker({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Ink colour">
      {INKS.map((ink) => (
        <button
          key={ink.value}
          type="button"
          title={ink.label}
          aria-label={`Ink: ${ink.label}`}
          aria-pressed={value === ink.value}
          className="size-5 rounded-full ring-1 ring-black/20 outline-offset-2 aria-pressed:outline-2 aria-pressed:outline-primary"
          style={{ background: ink.value }}
          onClick={() => onChange(ink.value)}
        />
      ))}
    </div>
  )
}

/** Draw with mouse, pen or finger. */
function DrawPad({ register }: { register: (producer: Producer) => void }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ink, setInk] = useState(INKS[0].value)
  const [empty, setEmpty] = useState(true)
  const inkRef = useRef(ink)
  useEffect(() => {
    inkRef.current = ink
  }, [ink])

  useEffect(() => {
    register(async () => {
      const element = canvas.current
      const pixels = element ? canvasPixels(element) : null
      const cropped = pixels ? cropToInk(pixels) : null
      return cropped ? pixelsToPng(cropped) : null
    })
  }, [register])

  const clear = (): void => {
    const element = canvas.current
    element?.getContext('2d')?.clearRect(0, 0, element.width, element.height)
    setEmpty(true)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const element = event.currentTarget
    const context = element.getContext('2d')
    if (!context || event.button !== 0) return
    element.setPointerCapture(event.pointerId)
    const bounds = element.getBoundingClientRect()
    const at = (pointer: { clientX: number; clientY: number }): { x: number; y: number } => ({
      x: ((pointer.clientX - bounds.left) * element.width) / bounds.width,
      y: ((pointer.clientY - bounds.top) * element.height) / bounds.height
    })
    context.strokeStyle = inkRef.current
    context.fillStyle = inkRef.current
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = 2.6 * DETAIL
    let previous = at(event)
    let middle = previous
    context.beginPath()
    context.arc(previous.x, previous.y, context.lineWidth / 2, 0, Math.PI * 2)
    context.fill()
    setEmpty(false)
    const move = (pointer: PointerEvent): void => {
      const point = at(pointer)
      // A curve through the midpoints keeps fast strokes smooth.
      const next = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 }
      context.beginPath()
      context.moveTo(middle.x, middle.y)
      context.quadraticCurveTo(previous.x, previous.y, next.x, next.y)
      context.stroke()
      previous = point
      middle = next
    }
    const end = (): void => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', end)
      element.removeEventListener('pointercancel', end)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', end)
    element.addEventListener('pointercancel', end)
  }

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvas}
        width={520 * DETAIL}
        height={PAD_HEIGHT * DETAIL}
        aria-label="Signature pad: draw here"
        className="h-40 w-full touch-none rounded-md border bg-white"
        style={{ cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
      />
      <div className="flex items-center justify-between">
        <InkPicker value={ink} onChange={setInk} />
        <span className="text-xs text-muted-foreground">
          {empty ? 'Sign above with your mouse, pen or finger.' : ''}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      </div>
    </div>
  )
}

/** Type a name, set in a handwriting font. */
function TypePad({
  register,
  initialText
}: {
  register: (producer: Producer) => void
  initialText: string
}): React.JSX.Element {
  const [text, setText] = useState(initialText)
  const [font, setFont] = useState<(typeof HANDWRITING)[number]>(HANDWRITING[0])
  const [ink, setInk] = useState(INKS[0].value)

  useEffect(() => {
    register(async () => {
      const value = text.trim()
      if (!value) return null
      const size = 64 * DETAIL
      const spec = `${size}px "${font}"`
      await document.fonts.load(spec, value)
      const measure = document.createElement('canvas').getContext('2d')
      if (!measure) return null
      measure.font = spec
      const width = Math.ceil(measure.measureText(value).width + size)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = Math.ceil(size * 1.8)
      const context = canvas.getContext('2d')
      if (!context) return null
      context.font = spec
      context.fillStyle = ink
      context.textBaseline = 'middle'
      context.fillText(value, size / 2, canvas.height / 2)
      const pixels = canvasPixels(canvas)
      const cropped = pixels ? cropToInk(pixels) : null
      return cropped ? pixelsToPng(cropped) : null
    })
  }, [register, text, font, ink])

  return (
    <div className="grid gap-3">
      <Input
        value={text}
        maxLength={60}
        aria-label="Your name"
        placeholder="Type your name"
        onChange={(event) => setText(event.target.value)}
        className="select-text"
      />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Handwriting style">
        {HANDWRITING.map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={font === name}
            onClick={() => setFont(name)}
            className={cn(
              'h-16 truncate rounded-md border bg-white px-3 text-left text-[28px] text-black',
              font === name && 'ring-2 ring-primary'
            )}
            style={{ fontFamily: `"${name}"`, color: ink }}
          >
            {text.trim() || 'Your name'}
          </button>
        ))}
      </div>
      <InkPicker value={ink} onChange={setInk} />
    </div>
  )
}

/** Upload a photo or scan; the background is removed. */
function UploadPad({ register }: { register: (producer: Producer) => void }): React.JSX.Element {
  const [source, setSource] = useState<Pixels | null>(null)
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [error, setError] = useState('')
  const preview = useRef<HTMLCanvasElement>(null)

  const processed = (): Pixels | null =>
    source ? cropToInk(removeBackground(source, threshold)) : null

  useEffect(() => {
    register(async () => {
      const result = processed()
      return result ? pixelsToPng(result) : null
    })
  })

  useEffect(() => {
    const canvas = preview.current
    const result = processed()
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    if (!result) {
      canvas.width = 1
      canvas.height = 1
      return
    }
    canvas.width = result.width
    canvas.height = result.height
    context.putImageData(new ImageData(result.data, result.width, result.height), 0, 0)
    // The preview follows the source and threshold only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, threshold])

  const choose = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setError('')
    try {
      const bitmap = await createImageBitmap(file)
      const scale = downscale(bitmap.width, bitmap.height, UPLOAD_LIMIT)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      setSource(canvasPixels(canvas))
    } catch {
      setError('This file could not be read as a picture.')
    }
  }

  return (
    <div className="grid gap-3">
      <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed text-sm hover:bg-accent">
        <Upload className="size-4" aria-hidden />
        {source ? 'Choose another picture…' : 'Choose a photo or scan…'}
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {source && (
        <>
          <div className="flex h-32 items-center justify-center rounded-md border bg-[repeating-conic-gradient(#f3f3f3_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
            <canvas ref={preview} className="max-h-28 max-w-full" aria-label="Preview" />
          </div>
          <label className="grid gap-1 text-[13px]">
            <span className="flex justify-between">
              <span>Background removal</span>
              <span className="text-muted-foreground">{threshold}</span>
            </span>
            <input
              type="range"
              min={80}
              max={245}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
            <span className="text-xs text-muted-foreground">
              Raise it if paper remains; lower it if strokes break up.
            </span>
          </label>
        </>
      )}
    </div>
  )
}

function LibraryEntry({ entry }: { entry: SignatureEntry }): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(entry.name)
  const canPlace = getActiveTab() !== null
  return (
    <li className="flex items-center gap-2 rounded-md border bg-white p-1.5 pr-2 text-black">
      <img src={previewUrl(entry)} alt={entry.name} className="h-10 w-28 shrink-0 object-contain" />
      {renaming ? (
        <form
          className="flex flex-1 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            setRenaming(false)
            void renameSignature(entry.id, name)
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={80}
            aria-label="Name"
            onChange={(event) => setName(event.target.value)}
            className="h-7 select-text text-[13px]"
          />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Save name"
          >
            <Check className="size-4" />
          </Button>
        </form>
      ) : (
        <span className="flex-1 truncate text-[13px]">{entry.name}</span>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 text-neutral-600"
        title={entry.isDefault ? 'Default' : 'Make default'}
        aria-label={entry.isDefault ? 'Default' : 'Make default'}
        aria-pressed={entry.isDefault}
        onClick={() => void setDefaultSignature(entry.id)}
      >
        <Star className={cn('size-4', entry.isDefault && 'fill-amber-400 text-amber-500')} />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 text-neutral-600"
        title="Rename"
        aria-label="Rename"
        onClick={() => setRenaming(true)}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 text-neutral-600"
        title="Delete"
        aria-label="Delete"
        onClick={() => void removeSignature(entry.id)}
      >
        <Trash2 className="size-4" />
      </Button>
      {canPlace && (
        <Button
          type="button"
          size="sm"
          className="h-7"
          onClick={() => {
            useSignatures.getState().showDialog(null)
            void armSignature(entry.kind, { entryId: entry.id })
          }}
        >
          Place
        </Button>
      )}
    </li>
  )
}

function SignatureForm({ initialKind }: { initialKind: SignatureKind }): React.JSX.Element {
  const [kind, setKind] = useState<SignatureKind>(initialKind)
  const [method, setMethod] = useState('draw')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const producer = useRef<Producer>(async () => null)
  const register = useCallback((next: Producer) => {
    producer.current = next
  }, [])
  const allEntries = useSignatures((state) => state.entries)
  const entries = entriesOf(allEntries, kind)
  const what = kind === 'signature' ? 'signature' : 'initials'

  useEffect(() => {
    void loadSignatures()
  }, [])

  const save = async (place: boolean): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const png = await producer.current()
      if (!png) {
        setMessage(`There is nothing to save yet: create your ${what} first.`)
        return
      }
      const entry = await addSignature(
        kind,
        name || (kind === 'signature' ? 'Signature' : 'Initials'),
        png
      )
      if (!entry) return
      setName('')
      if (place) {
        useSignatures.getState().showDialog(null)
        void armSignature(kind, { entryId: entry.id })
      } else {
        setMessage(`Saved. It is now in your ${what}.`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-base">Signatures and initials</DialogTitle>
        <DialogDescription>
          These are pictures of your handwriting placed on the page. They are not certificate-based
          digital signatures and do not prove who signed.
        </DialogDescription>
      </DialogHeader>

      <Tabs value={kind} onValueChange={(value) => setKind(value as SignatureKind)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="signature">Signatures</TabsTrigger>
          <TabsTrigger value="initials">Initials</TabsTrigger>
        </TabsList>
      </Tabs>

      {entries.length > 0 && (
        <section className="grid gap-1.5">
          <h3 className="text-[13px] font-medium">Your {what}</h3>
          <ul className="grid max-h-44 gap-1.5 overflow-y-auto">
            {entries.map((entry) => (
              <LibraryEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-2">
        <h3 className="text-[13px] font-medium">Create new {what}</h3>
        <Tabs value={method} onValueChange={setMethod}>
          <TabsList>
            <TabsTrigger value="draw">Draw</TabsTrigger>
            <TabsTrigger value="type">Type</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
          </TabsList>
          <TabsContent value="draw" className="pt-2">
            {method === 'draw' && <DrawPad key={kind} register={register} />}
          </TabsContent>
          <TabsContent value="type" className="pt-2">
            {method === 'type' && <TypePad key={kind} register={register} initialText="" />}
          </TabsContent>
          <TabsContent value="upload" className="pt-2">
            {method === 'upload' && <UploadPad key={kind} register={register} />}
          </TabsContent>
        </Tabs>
        <div className="flex items-center gap-2">
          <Input
            value={name}
            maxLength={80}
            aria-label="Name for this entry"
            placeholder={`Name (optional), e.g. "Full ${what}"`}
            onChange={(event) => setName(event.target.value)}
            className="h-8 flex-1 select-text text-[13px]"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Save
          </Button>
          {getActiveTab() !== null && (
            <Button type="button" size="sm" disabled={busy} onClick={() => void save(true)}>
              Save and place
            </Button>
          )}
        </div>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </section>
    </div>
  )
}

export function SignatureDialog(): React.JSX.Element {
  const kind = useSignatures((state) => state.dialog)
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(open) => !open && useSignatures.getState().showDialog(null)}
    >
      <DialogContent className="sm:max-w-xl">
        {kind !== null && <SignatureForm initialKind={kind} />}
      </DialogContent>
    </Dialog>
  )
}
