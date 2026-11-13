import { describe, expect, it } from 'vitest'
import {
  crop,
  cropToInk,
  downscale,
  inkBounds,
  removeBackground,
  type Pixels
} from './signatureImage'

/** A paper-coloured image with a dark blue stroke at the given pixels. */
function scan(width: number, height: number, ink: [number, number][], paper = 235): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data.set([paper, paper, paper - 10, 255], index)
  }
  for (const [x, y] of ink) data.set([20, 30, 120, 255], (y * width + x) * 4)
  return { width, height, data }
}

function alphaAt(image: Pixels, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3]
}

describe('removeBackground', () => {
  it('makes paper transparent and keeps ink opaque in its colour', () => {
    const result = removeBackground(scan(4, 4, [[1, 2]]))
    expect(alphaAt(result, 0, 0)).toBe(0)
    expect(alphaAt(result, 1, 2)).toBe(255)
    expect([...result.data.subarray((2 * 4 + 1) * 4, (2 * 4 + 1) * 4 + 3)]).toEqual([20, 30, 120])
  })

  it('follows the threshold: a grey background stays or goes', () => {
    const grey = scan(2, 1, [], 150)
    expect(alphaAt(removeBackground(grey, 120), 0, 0)).toBe(0)
    expect(alphaAt(removeBackground(grey, 250), 0, 0)).toBe(255)
  })

  it('fades edges in instead of cutting them hard', () => {
    const image = scan(1, 1, [], 0)
    image.data.set([140, 140, 140, 255], 0)
    const alpha = alphaAt(removeBackground(image, 170), 0, 0)
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(255)
  })

  it('respects transparency already there', () => {
    const image = scan(1, 1, [[0, 0]])
    image.data[3] = 100
    expect(alphaAt(removeBackground(image), 0, 0)).toBe(100)
  })
})

describe('cropping to the ink', () => {
  const image = removeBackground(
    scan(10, 8, [
      [2, 3],
      [6, 5]
    ])
  )

  it('finds the box around the ink', () => {
    expect(inkBounds(image)).toEqual({ x: 2, y: 3, width: 5, height: 3 })
  })

  it('crops with a transparent margin', () => {
    const cropped = cropToInk(image, 2)
    expect(cropped).not.toBeNull()
    expect([cropped?.width, cropped?.height]).toEqual([9, 7])
    expect(alphaAt(cropped as Pixels, 2, 2)).toBe(255)
    expect(alphaAt(cropped as Pixels, 0, 0)).toBe(0)
  })

  it('reports an image without ink', () => {
    expect(cropToInk(removeBackground(scan(5, 5, [])))).toBeNull()
  })

  it('leaves pixels outside the source transparent', () => {
    const part = crop(image, { x: 8, y: 6, width: 4, height: 4 })
    expect(part.width).toBe(4)
    expect(alphaAt(part, 3, 3)).toBe(0)
  })

  it('only scales down', () => {
    expect(downscale(4000, 1000, 1000)).toBe(0.25)
    expect(downscale(200, 100, 1000)).toBe(1)
  })
})
