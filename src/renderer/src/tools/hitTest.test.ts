import { describe, expect, it } from 'vitest'
import type { Annotation } from '@/api/engine'
import { annotationAt, inQuad } from './hitTest'
import { textQuad } from './quads'

function annotation(patch: Partial<Annotation>): Annotation {
  return {
    annotId: 1,
    page: 0,
    type: 'note',
    rect: [0, 0, 0, 0],
    color: '#ffd54f',
    opacity: 1,
    contents: '',
    author: '',
    createdAt: null,
    modifiedAt: null,
    ...patch
  }
}

describe('annotation hit testing', () => {
  const highlight = annotation({
    annotId: 10,
    type: 'highlight',
    rect: [68, 98, 204, 114],
    quads: [textQuad([72, 100, 200, 112], 0)]
  })
  const note = annotation({ annotId: 11, type: 'note', rect: [150, 95, 166, 111] })

  it('finds text markup by its quads', () => {
    expect(annotationAt([highlight], { x: 100, y: 106 })?.annotId).toBe(10)
    expect(annotationAt([highlight], { x: 100, y: 130 })).toBeNull()
  })

  it('prefers a note on top of a highlight', () => {
    expect(annotationAt([note, highlight], { x: 155, y: 105 })?.annotId).toBe(11)
    expect(annotationAt([highlight, note], { x: 155, y: 105 })?.annotId).toBe(11)
  })

  it('uses the later of two overlapping annotations', () => {
    const other = { ...highlight, annotId: 12 }
    expect(annotationAt([highlight, other], { x: 100, y: 106 })?.annotId).toBe(12)
  })

  it('works with quads of rotated text', () => {
    for (const angle of [90, 180, 270]) {
      const quad = textQuad([100, 200, 120, 300], angle)
      expect(inQuad({ x: 110, y: 250 }, quad)).toBe(true)
      expect(inQuad({ x: 130, y: 250 }, quad)).toBe(false)
    }
  })
})
