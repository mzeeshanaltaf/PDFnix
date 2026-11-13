import { describe, expect, it } from 'vitest'
import type { TextBlock } from '@/api/engine'
import { blockStyle } from './blockStyle'

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
