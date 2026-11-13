import { describe, expect, it } from 'vitest'
import type { Rect } from '@/api/engine'
import { CSS_PX_PER_PT } from '@/lib/units'
import {
  boxAround,
  clampToPage,
  fitInside,
  lineEnd,
  mapPoint,
  moveRect,
  pxToPtDelta,
  quarterTurnRect,
  rectFromDrag,
  resizeRect,
  smoothStroke
} from './editGeometry'
import { rotateRect } from './geometry'

const box: Rect = [100, 100, 200, 150]
const page = { width: 612, height: 792 }

function close(actual: Rect, expected: Rect): void {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6))
}

describe('pointer movements under zoom', () => {
  it('turns CSS pixels into points at any zoom', () => {
    for (const zoom of [0.5, 1, 2.5]) {
      const delta = pxToPtDelta(30, -12, zoom)
      expect(delta.x).toBeCloseTo(30 / (zoom * CSS_PX_PER_PT))
      expect(delta.y).toBeCloseTo(-12 / (zoom * CSS_PX_PER_PT))
    }
  })

  it('moves the same distance on the page whatever the zoom', () => {
    const at = (zoom: number): Rect => {
      const { x, y } = pxToPtDelta(40 * zoom, 20 * zoom, zoom)
      return moveRect(box, x, y)
    }
    close(at(0.5), at(3))
  })
})

describe('resizeRect', () => {
  it('drags one edge or corner and keeps the opposite one', () => {
    close(resizeRect(box, 'e', 20, 99), [100, 100, 220, 150])
    close(resizeRect(box, 'n', 99, -10), [100, 90, 200, 150])
    close(resizeRect(box, 'nw', -10, -20), [90, 80, 200, 150])
    close(resizeRect(box, 'se', 5, 5), [100, 100, 205, 155])
  })

  it('never goes below the minimum size, even dragged past the other edge', () => {
    close(resizeRect(box, 'w', 500, 0, { min: 4 }), [196, 100, 200, 150])
    close(resizeRect(box, 's', 0, -500, { min: 4 }), [100, 100, 200, 104])
  })

  it('keeps the aspect ratio from a corner, anchored at the opposite corner', () => {
    const result = resizeRect(box, 'se', 100, 0, { aspect: 2 })
    close(result, [100, 100, 300, 200])
    const shrunk = resizeRect(box, 'nw', 50, 0, { aspect: 2 })
    close(shrunk, [150, 125, 200, 150])
  })

  it('follows the direction that moved further', () => {
    const result = resizeRect(box, 'se', 10, 50, { aspect: 2 })
    // Height doubled (50 -> 100); width follows.
    close(result, [100, 100, 300, 200])
  })

  it('grows the other dimension about the centre from an edge', () => {
    const result = resizeRect(box, 'e', 100, 0, { aspect: 2 })
    close(result, [100, 75, 300, 175])
    const tall = resizeRect(box, 's', 0, 50, { aspect: 2 })
    close(tall, [50, 100, 250, 200])
  })
})

describe('quarter turns', () => {
  it('swaps width and height about the centre', () => {
    close(quarterTurnRect(box), [125, 75, 175, 175])
    close(quarterTurnRect(quarterTurnRect(box)), box)
  })

  it('works the same on a rotated page: boxes are in displayed space', () => {
    // A box on a page, then the page turned 90°: the engine reports the
    // turned box; editing it is the same arithmetic.
    const turned = rotateRect(box, page, 90)
    expect(quarterTurnRect(turned)[2] - quarterTurnRect(turned)[0]).toBeCloseTo(
      turned[3] - turned[1]
    )
  })
})

describe('placing', () => {
  it('keeps boxes on the page', () => {
    close(clampToPage([-10, 780, 40, 830], page), [0, 742, 50, 792])
    close(clampToPage([0, 0, 1000, 10], page), [0, 0, 1000, 10])
  })

  it('makes a box from a drag in any direction, optionally square', () => {
    close(rectFromDrag({ x: 50, y: 60 }, { x: 10, y: 20 }), [10, 20, 50, 60])
    close(rectFromDrag({ x: 0, y: 0 }, { x: 30, y: -10 }, true), [0, -30, 30, 0])
  })

  it('snaps lines to 45 degrees', () => {
    const end = lineEnd({ x: 0, y: 0 }, { x: 10, y: 1 }, true)
    expect(end.y).toBeCloseTo(0)
    expect(end.x).toBeCloseTo(Math.hypot(10, 1))
  })

  it('scales points from one box to another', () => {
    expect(mapPoint({ x: 150, y: 125 }, box, [0, 0, 200, 100])).toEqual({ x: 100, y: 50 })
    // A flat box only moves along its flat axis.
    expect(mapPoint({ x: 5, y: 10 }, [0, 10, 10, 10], [0, 20, 20, 20])).toEqual({ x: 10, y: 20 })
  })

  it('fits images inside a limit without enlarging them', () => {
    expect(fitInside({ width: 400, height: 200 }, { width: 100, height: 100 })).toEqual({
      width: 100,
      height: 50
    })
    expect(fitInside({ width: 40, height: 20 }, { width: 100, height: 100 })).toEqual({
      width: 40,
      height: 20
    })
    close(boxAround({ x: 5, y: 5 }, { width: 20, height: 10 }, page), [0, 0, 20, 10])
  })
})

describe('smoothStroke', () => {
  it('drops points that barely move and keeps both ends', () => {
    const stroke = smoothStroke([
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ])
    expect(stroke[0]).toEqual({ x: 0, y: 0 })
    expect(stroke[stroke.length - 1]).toEqual({ x: 10, y: 10 })
    expect(stroke.some((point) => point.x === 0.1)).toBe(false)
  })

  it('rounds corners', () => {
    const stroke = smoothStroke([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ])
    // The sharp corner at (10, 0) is cut.
    expect(stroke.some((point) => point.x === 10 && point.y === 0)).toBe(false)
  })
})
