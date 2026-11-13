import { describe, expect, it } from 'vitest'
import type { Quad, Rect } from '@/api/engine'
import {
  cssScale,
  MAX_RENDER_PIXELS,
  quadBounds,
  quarterTurns,
  rectToPx,
  renderScale,
  rotatedSize,
  rotatePoint,
  rotateQuad,
  rotateRect,
  sizeToPx
} from './geometry'

const LETTER = { width: 612, height: 792 }

describe('points to pixels under zoom', () => {
  it('uses 96/72 CSS pixels per point at 100 %', () => {
    expect(cssScale(1)).toBeCloseTo(4 / 3)
    expect(sizeToPx(LETTER, 1)).toEqual({ width: 816, height: 1056 })
  })

  it('scales linearly with the zoom', () => {
    expect(sizeToPx(LETTER, 0.5)).toEqual({ width: 408, height: 528 })
    expect(sizeToPx(LETTER, 2)).toEqual({ width: 1632, height: 2112 })
    expect(sizeToPx(LETTER, 0.1).width).toBeCloseTo(81.6)
    expect(sizeToPx(LETTER, 8).width).toBeCloseTo(6528)
  })

  it('turns a rectangle into a CSS box', () => {
    const rect: Rect = [72, 144, 216, 180]
    expect(rectToPx(rect, 1)).toEqual({ left: 96, top: 192, width: 192, height: 48 })
    expect(rectToPx(rect, 1.5)).toEqual({ left: 144, top: 288, width: 288, height: 72 })
  })

  it('finds the bounds of a quad', () => {
    const quad: Quad = [10, 20, 50, 20, 10, 30, 50, 30]
    expect(quadBounds(quad)).toEqual([10, 20, 50, 30])
  })
})

describe('render scale', () => {
  it('asks for one image pixel per device pixel', () => {
    expect(renderScale(1, 1, LETTER)).toBeCloseTo(1.333, 3)
    expect(renderScale(1, 1.5, LETTER)).toBeCloseTo(2, 3)
    expect(renderScale(2, 2, LETTER)).toBeCloseTo(5.333, 3)
  })

  it('stays within the engine pixel budget', () => {
    const scale = renderScale(8, 2, LETTER)
    expect(LETTER.width * scale * LETTER.height * scale).toBeLessThanOrEqual(MAX_RENDER_PIXELS)
    expect(LETTER.width * scale * LETTER.height * scale).toBeGreaterThan(MAX_RENDER_PIXELS * 0.99)
  })
})

describe('rotation', () => {
  it('normalises angles to quarter turns', () => {
    expect([0, 90, 180, 270, 360, -90, 450, 89].map(quarterTurns)).toEqual([
      0, 90, 180, 270, 0, 270, 90, 90
    ])
  })

  it('swaps width and height for 90 and 270', () => {
    expect(rotatedSize(LETTER, 0)).toEqual(LETTER)
    expect(rotatedSize(LETTER, 90)).toEqual({ width: 792, height: 612 })
    expect(rotatedSize(LETTER, 180)).toEqual(LETTER)
    expect(rotatedSize(LETTER, 270)).toEqual({ width: 792, height: 612 })
    expect(rotatedSize(LETTER, -90)).toEqual({ width: 792, height: 612 })
  })

  // The top-left corner of the page goes to the top-right after a clockwise
  // quarter turn, to the bottom-right after a half turn, and so on.
  it.each([
    [0, { x: 0, y: 0 }],
    [90, { x: 792, y: 0 }],
    [180, { x: 612, y: 792 }],
    [270, { x: 0, y: 612 }]
  ])('moves the top-left corner correctly at %i°', (degrees, expected) => {
    expect(rotatePoint({ x: 0, y: 0 }, LETTER, degrees)).toEqual(expected)
  })

  it.each([0, 90, 180, 270])('keeps points inside the turned page at %i°', (degrees) => {
    const turned = rotatedSize(LETTER, degrees)
    for (const point of [
      { x: 0, y: 0 },
      { x: 612, y: 0 },
      { x: 0, y: 792 },
      { x: 612, y: 792 },
      { x: 100, y: 700 }
    ]) {
      const moved = rotatePoint(point, LETTER, degrees)
      expect(moved.x).toBeGreaterThanOrEqual(0)
      expect(moved.y).toBeGreaterThanOrEqual(0)
      expect(moved.x).toBeLessThanOrEqual(turned.width)
      expect(moved.y).toBeLessThanOrEqual(turned.height)
    }
  })

  it('agrees with the engine for a quarter turn: (x, y) -> (height - y, x)', () => {
    expect(rotatePoint({ x: 72, y: 100 }, LETTER, 90)).toEqual({ x: 692, y: 72 })
  })

  it('four quarter turns bring a rectangle back', () => {
    const rect: Rect = [72, 100, 200, 120]
    let current = rect
    let size = LETTER
    for (let i = 0; i < 4; i += 1) {
      current = rotateRect(current, size, 90)
      size = rotatedSize(size, 90)
    }
    expect(current).toEqual(rect)
  })

  it('a turn and its reverse cancel out', () => {
    const rect: Rect = [72, 100, 200, 120]
    const there = rotateRect(rect, LETTER, 90)
    expect(rotateRect(there, rotatedSize(LETTER, 90), -90)).toEqual(rect)
  })

  it('rotates quads corner by corner and keeps their bounds consistent', () => {
    const quad: Quad = [72, 100, 200, 100, 72, 120, 200, 120]
    for (const degrees of [90, 180, 270]) {
      const turned = rotateQuad(quad, LETTER, degrees)
      expect(quadBounds(turned)).toEqual(rotateRect(quadBounds(quad), LETTER, degrees))
    }
  })
})
