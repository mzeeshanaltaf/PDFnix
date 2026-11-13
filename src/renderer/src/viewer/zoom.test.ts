import { describe, expect, it } from 'vitest'
import { CSS_PX_PER_PT } from './geometry'
import { PAGE_GAP, VIEW_PADDING } from './layout'
import {
  clampZoom,
  fitZoom,
  formatZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  parseZoom,
  stepZoom,
  wheelZoom
} from './zoom'

const A4 = { width: 595, height: 842 }
const VIEWPORT = { width: 1000, height: 700 }

describe('zoom range', () => {
  it('is 10 % to 800 %', () => {
    expect(MIN_ZOOM).toBe(0.1)
    expect(MAX_ZOOM).toBe(8)
    expect(clampZoom(0.01)).toBe(0.1)
    expect(clampZoom(20)).toBe(8)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it('steps through the stops and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(1.05, 1)).toBe(1.1)
    expect(stepZoom(1.05, -1)).toBe(1)
    expect(stepZoom(8, 1)).toBe(8)
    expect(stepZoom(0.1, -1)).toBe(0.1)
  })

  it('zooms in for wheel up and out for wheel down, within range', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1)
    expect(wheelZoom(1, 100)).toBeLessThan(1)
    expect(wheelZoom(7.9, -10_000)).toBe(8)
    // A notch up and a notch down cancel out.
    expect(wheelZoom(wheelZoom(1, -100), 100)).toBeCloseTo(1)
  })
})

describe('fitZoom', () => {
  it('fits the width of the widest page', () => {
    const zoom = fitZoom('fit-width', VIEWPORT, [A4], 'continuous', 0)
    expect(A4.width * zoom * CSS_PX_PER_PT).toBeCloseTo(VIEWPORT.width - VIEW_PADDING * 2)
  })

  it('fits a whole page', () => {
    const zoom = fitZoom('fit-page', VIEWPORT, [A4], 'continuous', 0)
    expect(A4.height * zoom * CSS_PX_PER_PT).toBeCloseTo(VIEWPORT.height - VIEW_PADDING * 2)
  })

  it('fits two pages side by side in two-page mode', () => {
    const zoom = fitZoom('fit-width', VIEWPORT, [A4, A4], 'two-page', 0)
    expect(2 * A4.width * zoom * CSS_PX_PER_PT + PAGE_GAP).toBeCloseTo(
      VIEWPORT.width - VIEW_PADDING * 2
    )
  })

  it('uses only the shown page in single mode', () => {
    const wide = { width: 1190, height: 842 }
    const continuous = fitZoom('fit-width', VIEWPORT, [A4, wide], 'continuous', 0)
    const single = fitZoom('fit-width', VIEWPORT, [A4, wide], 'single', 0)
    expect(single).toBeGreaterThan(continuous)
  })

  it('falls back to 100 % before the view has a size', () => {
    expect(fitZoom('fit-width', { width: 0, height: 0 }, [A4], 'continuous', 0)).toBe(1)
    expect(fitZoom('fit-page', VIEWPORT, [], 'continuous', 0)).toBe(1)
  })
})

describe('the zoom box', () => {
  it('formats as a whole percentage', () => {
    expect(formatZoom(1)).toBe('100%')
    expect(formatZoom(0.333)).toBe('33%')
  })

  it('reads what people type', () => {
    expect(parseZoom('150')).toBe(1.5)
    expect(parseZoom(' 75 % ')).toBe(0.75)
    expect(parseZoom('12,5%')).toBe(0.125)
    expect(parseZoom('5000')).toBe(8)
    expect(parseZoom('abc')).toBeNull()
    expect(parseZoom('0')).toBeNull()
    expect(parseZoom('')).toBeNull()
  })
})
