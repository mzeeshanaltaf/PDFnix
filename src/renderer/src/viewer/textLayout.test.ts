import { describe, expect, it } from 'vitest'
import type { TextLine } from '@/api/engine'
import { layoutLine } from './textLayout'

const line = (angle: number, words: [string, [number, number, number, number]][]): TextLine => ({
  angle,
  bbox: [0, 0, 0, 0],
  words: words.map(([text, bbox]) => ({ text, bbox }))
})

describe('layoutLine', () => {
  it('adds spaces between words and marks the end of the line', () => {
    const spans = layoutLine(
      line(0, [
        ['Hello', [72, 100, 100, 112]],
        ['world', [104, 100, 134, 112]]
      ])
    )
    expect(spans.map((span) => span.text)).toEqual(['Hello ', 'world'])
    expect(spans.map((span) => span.endOfLine)).toEqual([false, true])
  })

  it('stretches a span to the next word so selection has no gaps', () => {
    const [first, second] = layoutLine(
      line(0, [
        ['Hello', [72, 100, 100, 112]],
        ['world', [104, 100, 134, 112]]
      ])
    )
    expect(first).toMatchObject({ x: 72, y: 100, length: 32, thickness: 12, rotation: 0 })
    expect(second.length).toBe(30)
  })

  it('does not bridge a column gap', () => {
    const [first] = layoutLine(
      line(0, [
        ['left', [72, 100, 100, 112]],
        ['right', [400, 100, 430, 112]]
      ])
    )
    expect(first.length).toBe(28)
  })

  it.each([
    // angle, bbox of a 30 x 12 word as seen on the page, expected anchor
    [90, [500, 72, 512, 102], { x: 512, y: 72 }],
    [180, [72, 500, 102, 512], { x: 102, y: 512 }],
    [270, [100, 400, 112, 430], { x: 100, y: 430 }]
  ] as const)('anchors rotated text at its own top-left corner (%i°)', (angle, bbox, anchor) => {
    const [span] = layoutLine(line(angle, [['word', [...bbox]]]))
    expect(span).toMatchObject({ ...anchor, length: 30, thickness: 12, rotation: angle })
  })

  it('stretches downward-reading words to the next one too', () => {
    const [first] = layoutLine(
      line(90, [
        ['one', [500, 72, 512, 90]],
        ['two', [500, 94, 512, 110]]
      ])
    )
    expect(first.length).toBe(22)
  })

  it('skips empty or degenerate words but still ends the line', () => {
    const spans = layoutLine(
      line(0, [
        ['a', [72, 100, 80, 112]],
        ['', [84, 100, 90, 112]],
        ['b', [94, 100, 94, 112]]
      ])
    )
    expect(spans.map((span) => span.text)).toEqual(['a '])
    expect(spans[0].endOfLine).toBe(true)
  })
})
