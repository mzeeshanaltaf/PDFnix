/**
 * Getting pictures into the document: from a file, the clipboard or the
 * signature library, as a pending image in the edit overlay.
 *
 * The engine takes PNG, JPEG and SVG. Anything else the browser can decode
 * (WebP, GIF, BMP, a clipboard bitmap) is converted to PNG here first.
 */

import { toast } from 'sonner'
import type { Rotation } from '@/api/engine'
import { startPending } from '@/state/pending'
import { getTab } from '@/state/tabs'
import { useTools } from '@/state/tools'
import { boxAround, fitInside } from '@/viewer/editGeometry'
import type { Point } from '@/viewer/geometry'

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/bmp'

/** Points per CSS pixel: a picture is first shown at 96 pixels per inch. */
const PT_PER_PX = 72 / 96

export interface LoadedImage {
  /** PNG, JPEG or SVG, base64. */
  data: string
  /** Natural size in pixels. */
  width: number
  height: number
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsDataURL(blob)
  })
}

export function base64ToBlob(data: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
  return new Blob([bytes], { type })
}

function loadElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The picture could not be read.'))
    image.src = url
  })
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (png) => (png ? resolve(png) : reject(new Error('The picture could not be converted.'))),
      'image/png'
    )
  )
}

function isSvg(blob: Blob): boolean {
  return blob.type === 'image/svg+xml' || (blob instanceof File && /\.svg$/i.test(blob.name))
}

/** Reads a picture into the form the engine takes. */
export async function loadImage(blob: Blob): Promise<LoadedImage> {
  if (isSvg(blob)) {
    const svg = new Blob([await blob.arrayBuffer()], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(svg)
    try {
      const element = await loadElement(url)
      return {
        data: await blobToBase64(svg),
        width: element.naturalWidth || 300,
        height: element.naturalHeight || 150
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const usable = blob.type === 'image/png' || blob.type === 'image/jpeg' ? blob : await toPng(blob)
  const bitmap = await createImageBitmap(usable)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return { data: await blobToBase64(usable), ...size }
}

function mimeOf(data: string): string {
  if (data.startsWith('iVBOR')) return 'image/png'
  if (data.startsWith('/9j/')) return 'image/jpeg'
  return 'image/svg+xml'
}

export interface PlaceOptions {
  label?: 'Image' | 'Signature' | 'Initials'
  /** Where its centre goes (points); the middle of the page if omitted. */
  center?: Point
  /** Largest width in points; by default half the page. */
  maxWidth?: number
}

/** Puts a picture on a page of a tab as the pending object. */
export function placeImage(
  tabId: string,
  page: number,
  image: LoadedImage,
  options: PlaceOptions = {}
): void {
  const tab = getTab(tabId)
  const pageInfo = tab?.pages[page]
  if (!tab || !pageInfo) return
  const natural = { width: image.width * PT_PER_PX, height: image.height * PT_PER_PX }
  const limit = {
    width: options.maxWidth ?? pageInfo.width / 2,
    height: pageInfo.height / 2
  }
  // Signatures are scaled to their width whatever their pixel size.
  const size =
    options.maxWidth !== undefined
      ? fitInside({ width: limit.width, height: (limit.width * image.height) / image.width }, limit)
      : fitInside(natural, limit)
  const center = options.center ?? { x: pageInfo.width / 2, y: pageInfo.height / 2 }
  const rotation: Rotation = 0
  startPending({
    tabId,
    page,
    object: {
      kind: 'image',
      rect: boxAround(center, size, pageInfo),
      rotation,
      data: image.data,
      url: URL.createObjectURL(base64ToBlob(image.data, mimeOf(image.data))),
      aspect: image.width / image.height,
      label: options.label ?? 'Image'
    }
  })
}

/** Asks for a picture file. Resolves to null if the user cancels. */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = IMAGE_ACCEPT
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

async function addFromBlob(tabId: string, blob: Blob): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  try {
    const image = await loadImage(blob)
    useTools.getState().setActiveTool('select')
    placeImage(tabId, tab.page, image)
  } catch (error) {
    toast.error('Could not add the image', {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

/** The Add Image tool: choose a file, then place it on the current page. */
export async function addImageFromFile(tabId: string): Promise<void> {
  const file = await pickImageFile()
  if (file) await addFromBlob(tabId, file)
}

/** Pasting a picture (Ctrl+V outside text boxes) adds it to the current page. */
export function installImagePaste(activeTabId: () => string | null): () => void {
  const onPaste = (event: ClipboardEvent): void => {
    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }
    const tabId = activeTabId()
    if (!tabId) return
    const file = [...(event.clipboardData?.files ?? [])].find((item) =>
      item.type.startsWith('image/')
    )
    if (!file) return
    event.preventDefault()
    void addFromBlob(tabId, file)
  }
  window.addEventListener('paste', onPaste)
  return () => window.removeEventListener('paste', onPaste)
}
