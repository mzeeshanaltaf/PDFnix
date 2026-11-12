import { describe, expect, it } from 'vitest'
import { CSS_PX_PER_PT, ptToPx, pxToPt } from './units'

describe('units', () => {
  it('converts points to CSS pixels: px = pt × zoom × 96/72', () => {
    expect(CSS_PX_PER_PT).toBeCloseTo(96 / 72)
    expect(ptToPx(72, 1)).toBeCloseTo(96)
    expect(ptToPx(72, 2)).toBeCloseTo(192)
    // US Letter is 612 × 792 pt.
    expect(ptToPx(612, 1)).toBeCloseTo(816)
    expect(ptToPx(792, 0.5)).toBeCloseTo(528)
  })

  it('converts CSS pixels back to points', () => {
    expect(pxToPt(96, 1)).toBeCloseTo(72)
    expect(pxToPt(192, 2)).toBeCloseTo(72)
  })

  it('round-trips', () => {
    for (const zoom of [0.25, 1, 1.5, 4]) {
      expect(pxToPt(ptToPx(123.45, zoom), zoom)).toBeCloseTo(123.45)
    }
  })
})
