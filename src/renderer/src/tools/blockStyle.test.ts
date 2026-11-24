import { describe, expect, it } from 'vitest'
import type { Rect, TextBlock } from '@/api/engine'
import { blockForPoint, blockStyle } from './blockStyle'

describe('blockForPoint', () => {
  const boxes = (...rects: Rect[]): { id: number; bbox: Rect }[] =>
    rects.map((bbox, id) => ({ id, bbox }))

  it('finds the block that holds the point', () => {
    const blocks = boxes([72, 72, 540, 120], [72, 140, 540, 300])
    expect(blockForPoint(blocks, { x: 100, y: 200 })?.id).toBe(1)
    // Edges count as inside.
    expect(blockForPoint(blocks, { x: 72, y: 72 })?.id).toBe(0)
  })

  it('takes the smallest of overlapping blocks', () => {
    const blocks = boxes([0, 0, 600, 800], [72, 140, 540, 300], [100, 150, 200, 170])
    expect(blockForPoint(blocks, { x: 150, y: 160 })?.id).toBe(2)
    expect(blockForPoint(blocks, { x: 300, y: 250 })?.id).toBe(1)
  })

  it('finds nothing outside every block, or without blocks', () => {
    expect(blockForPoint(boxes([72, 72, 540, 120]), { x: 50, y: 50 })).toBeNull()
    expect(blockForPoint([], { x: 50, y: 50 })).toBeNull()
  })
})

function block(
  lines: { x0: number; x1: number; spans: [string, string, number, number][] }[]
): TextBlock {
  return {
    blockId: '0',
    bbox: [0, 0, 500, 100],
    angle: 0,
    text: '',
    lines: lines.map((line, index) => ({
      bbox: [line.x0, index * 14, line.x1, index * 14 + 12],
      spans: line.spans.map(([text, font, size, flags]) => ({
        text,
        font,
        size,
        flags,
        color: '#112233'
      }))
    }))
  }
}

describe('blockStyle', () => {
  it('takes the style of the span with the most text', () => {
    const { style, fontName } = blockStyle(
      block([
        {
          x0: 72,
          x1: 300,
          spans: [
            ['Title: ', 'Arial-BoldMT', 12, 16],
            ['a much longer run of ordinary text', 'ArialMT', 11, 0]
          ]
        }
      ])
    )
    expect(fontName).toBe('ArialMT')
    expect(style).toMatchObject({ fontSize: 11, bold: false, italic: false, color: '#112233' })
    expect(style.fontFamily).toBeNull()
  })

  it('reads bold and italic from flags or the name', () => {
    expect(
      blockStyle(block([{ x0: 0, x1: 9, spans: [['x', 'Foo', 10, 16 | 2]] }])).style
    ).toMatchObject({
      bold: true,
      italic: true
    })
    expect(
      blockStyle(block([{ x0: 0, x1: 9, spans: [['x', 'Times-BoldItalic', 10, 0]] }])).style
    ).toMatchObject({
      bold: true,
      italic: true
    })
  })

  it('guesses the alignment from the line edges', () => {
    const lines = (edges: [number, number][]): ReturnType<typeof block> =>
      block(edges.map(([x0, x1]) => ({ x0, x1, spans: [['words', 'Arial', 10, 0]] })))
    expect(
      blockStyle(
        lines([
          [72, 300],
          [72, 250],
          [72, 120]
        ])
      ).style.align
    ).toBe('left')
    expect(
      blockStyle(
        lines([
          [100, 300],
          [150, 300],
          [200, 300]
        ])
      ).style.align
    ).toBe('right')
    expect(
      blockStyle(
        lines([
          [100, 300],
          [150, 250],
          [180, 220]
        ])
      ).style.align
    ).toBe('center')
  })

  it('treats turned text as starting at its beginning', () => {
    const turned = {
      ...block([
        { x0: 600, x1: 615, spans: [['words', 'Arial', 10, 0]] },
        { x0: 580, x1: 595, spans: [['more words', 'Arial', 10, 0]] }
      ]),
      angle: 90 as const
    }
    expect(blockStyle(turned).style.align).toBe('left')
  })
})
