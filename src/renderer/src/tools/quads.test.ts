import { describe, expect, it } from 'vitest'
import type { Quad, Rect } from '@/api/engine'
import { quadBounds, rotateQuad, rotateRect } from '@/viewer/geometry'
import { pieceRect, piecesToMarkup, textQuad, type WordPiece } from './quads'

function word(line: number, bbox: Rect, from = 0, to = 1, page = 0, angle = 0): WordPiece {
  return { page, line, angle, bbox, from, to }
}

describe('selection to quads', () => {
  it('merges the words of one line into one quad', () => {
    const groups = piecesToMarkup([
      word(0, [72, 100, 100, 112]),
      word(0, [104, 99, 140, 113]),
      word(0, [144, 100, 170, 112])
    ])
    expect(groups).toEqual([{ page: 0, quads: [[72, 99, 170, 99, 72, 113, 170, 113]] }])
  })

  it('gives each line of a multi-line selection its own quad, in order', () => {
    const groups = piecesToMarkup([
      word(3, [300, 100, 340, 112], 0.5, 1), // starts half way into the word
      word(3, [344, 100, 380, 112]),
      word(4, [72, 116, 120, 128]),
      word(5, [72, 132, 110, 144], 0, 0.25) // ends a quarter into the word
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].quads).toEqual([
      [320, 100, 380, 100, 320, 112, 380, 112],
      [72, 116, 120, 116, 72, 128, 120, 128],
      [72, 132, 81.5, 132, 72, 144, 81.5, 144]
    ])
  })

  it('splits a selection that crosses pages by page', () => {
    const groups = piecesToMarkup([
      word(9, [72, 700, 120, 712], 0, 1, 2),
      word(0, [72, 80, 120, 92], 0, 1, 3)
    ])
    expect(groups.map((group) => group.page)).toEqual([2, 3])
  })

  it('ignores pieces that select nothing', () => {
    expect(piecesToMarkup([word(0, [0, 0, 10, 10], 0.5, 0.5)])).toEqual([])
    expect(piecesToMarkup([])).toEqual([])
  })

  it('cuts partial words along the reading direction', () => {
    const box: Rect = [100, 200, 120, 260] // a word on a rotated line: tall box
    expect(pieceRect({ ...word(0, box, 0, 0.5), angle: 90 })).toEqual([100, 200, 120, 230])
    expect(pieceRect({ ...word(0, box, 0, 0.5), angle: 270 })).toEqual([100, 230, 120, 260])
    const wide: Rect = [100, 200, 160, 212]
    expect(pieceRect({ ...word(0, wide, 0, 0.5), angle: 180 })).toEqual([130, 200, 160, 212])
    expect(pieceRect(word(0, wide, 0.25, 0.75))).toEqual([115, 200, 145, 212])
  })

  describe('on rotated pages', () => {
    // A line of text on an upright page, and the same page turned.
    const page = { width: 612, height: 792 }
    const line: Rect = [72, 100, 200, 112]
    const upright = textQuad(line, 0)

    it.each([90, 180, 270])(
      'gives the same quad as turning the upright one (%i degrees)',
      (degrees) => {
        // On the turned page the line's box and reading direction turn with it.
        const turnedBox = rotateRect(line, page, degrees)
        const quad = piecesToMarkup([word(0, turnedBox, 0, 1, 0, degrees)])[0].quads[0]
        expect(quad).toEqual(rotateQuad(upright, page, degrees))
      }
    )

    it('covers the selected box', () => {
      for (const angle of [0, 90, 180, 270]) {
        const quad: Quad = textQuad([10, 20, 30, 60], angle)
        expect(quadBounds(quad)).toEqual([10, 20, 30, 60])
      }
    })
  })
})
