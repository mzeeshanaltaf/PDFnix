import { describe, expect, it } from 'vitest'
import { formatPageRanges, parsePageGroups, parsePageRanges } from './pageRanges'

describe('parsePageRanges', () => {
  it('reads single pages, ranges and open ends', () => {
    expect(parsePageRanges('1-3, 7, 10-', 12)).toEqual({
      ok: true,
      pages: [0, 1, 2, 6, 9, 10, 11]
    })
    expect(parsePageRanges('-2', 5)).toEqual({ ok: true, pages: [0, 1] })
    expect(parsePageRanges(' 4 ', 5)).toEqual({ ok: true, pages: [3] })
  })

  it('sorts and removes duplicates', () => {
    expect(parsePageRanges('5, 2-4; 3', 5)).toEqual({ ok: true, pages: [1, 2, 3, 4] })
  })

  it('accepts spaces around the dash', () => {
    expect(parsePageRanges('2 - 3', 5)).toEqual({ ok: true, pages: [1, 2] })
  })

  it('rejects pages that do not exist', () => {
    const result = parsePageRanges('1, 9', 5)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('Page 9 does not exist')
    expect(parsePageRanges('0', 5).ok).toBe(false)
  })

  it('rejects ranges that run backwards and text that is not a range', () => {
    expect(parsePageRanges('5-3', 9)).toEqual({ ok: false, error: '"5-3" runs backwards.' })
    expect(parsePageRanges('a-b', 9).ok).toBe(false)
    expect(parsePageRanges('-', 9).ok).toBe(false)
    expect(parsePageRanges('1-2-3', 9).ok).toBe(false)
  })

  it('needs something', () => {
    expect(parsePageRanges(' , ', 9).ok).toBe(false)
  })
})

describe('parsePageGroups', () => {
  it('keeps each part as a group, in the order typed', () => {
    expect(parsePageGroups('4-5, 1-3, 6-', 7)).toEqual({
      ok: true,
      groups: [
        [3, 4],
        [0, 1, 2],
        [5, 6]
      ]
    })
  })

  it('reports the first bad part', () => {
    expect(parsePageGroups('1-2, 8', 7).ok).toBe(false)
  })
})

describe('formatPageRanges', () => {
  it('joins runs', () => {
    expect(formatPageRanges([0, 1, 2, 6, 9, 10])).toBe('1-3, 7, 10-11')
    expect(formatPageRanges([4])).toBe('5')
    expect(formatPageRanges([])).toBe('')
    expect(formatPageRanges([3, 1, 2, 2])).toBe('2-4')
  })
})
