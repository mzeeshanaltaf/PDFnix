/**
 * Turning a photo or scan of a signature into a clean transparent picture:
 * the light background becomes transparent, the ink keeps its colour, and
 * the result is cropped to the ink. Works on plain RGBA buffers (the shape of
 * `ImageData`), so it runs anywhere and can be tested without a browser.
 */

export interface Pixels {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, rows top to bottom. */
  data: Uint8ClampedArray<ArrayBuffer>
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Default lightness (0–255) above which a pixel counts as background. */
export const DEFAULT_THRESHOLD = 170
/** Over this many levels below the threshold, ink fades in (soft edges). */
const SOFTNESS = 48

function lightness(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Makes everything lighter than `threshold` transparent. Darker pixels fade
 * in over a short range, so strokes keep smooth edges; their colour is kept
 * and existing transparency is respected.
 */
export function removeBackground(image: Pixels, threshold = DEFAULT_THRESHOLD): Pixels {
  const source = image.data
  const data = new Uint8ClampedArray(source.length)
  for (let index = 0; index < source.length; index += 4) {
    const r = source[index]
    const g = source[index + 1]
    const b = source[index + 2]
    const coverage = Math.min(1, Math.max(0, (threshold - lightness(r, g, b)) / SOFTNESS))
    data[index] = r
    data[index + 1] = g
    data[index + 2] = b
    data[index + 3] = Math.round(coverage * source[index + 3])
  }
  return { width: image.width, height: image.height, data }
}

/** The smallest box around pixels at least `minAlpha` opaque, or null if none. */
export function inkBounds(image: Pixels, minAlpha = 16): Bounds | null {
  let left = image.width
  let top = image.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] >= minAlpha) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (right < 0) return null
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/** A part of the image, grown by `padding` transparent pixels on every side. */
export function crop(image: Pixels, bounds: Bounds, padding = 0): Pixels {
  const width = bounds.width + padding * 2
  const height = bounds.height + padding * 2
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceY = bounds.y + y
    if (sourceY < 0 || sourceY >= image.height) continue
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceX = bounds.x + x
      if (sourceX < 0 || sourceX >= image.width) continue
      const from = (sourceY * image.width + sourceX) * 4
      const to = ((y + padding) * width + x + padding) * 4
      data.set(image.data.subarray(from, from + 4), to)
    }
  }
  return { width, height, data }
}

/** Crops to the ink with a small margin; null if the image has no ink. */
export function cropToInk(image: Pixels, padding = 4): Pixels | null {
  const bounds = inkBounds(image)
  return bounds ? crop(image, bounds, padding) : null
}

/** Scale that brings the longer side down to `limit` pixels (never up). */
export function downscale(width: number, height: number, limit: number): number {
  return Math.min(1, limit / Math.max(width, height))
}
