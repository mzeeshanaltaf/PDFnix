import { describe, expect, it } from 'vitest'
import type { Annotation } from '@/api/engine'
import { groupComments, mergePages } from './commentRows'

function annotation(annotId: number, patch: Partial<Annotation>): Annotation {
  return {
    annotId,
    page: 0,
    type: 'note',
    rect: [0, 0, 10, 10],
    color: '#ffd54f',
    opacity: 1,
    contents: '',
    author: 'Ada',
    createdAt: null,
    modifiedAt: null,
    ...patch
  }
}

describe('comments panel rows', () => {
  const all = [
    annotation(1, { page: 2, type: 'highlight', contents: 'Why?', rect: [0, 300, 10, 310] }),
    annotation(2, { page: 0, type: 'highlight', contents: '' }), // no comment: not listed
    annotation(3, { page: 2, type: 'note', contents: '', rect: [0, 100, 10, 110] }), // notes always
    annotation(4, { page: 1, type: 'square', contents: 'Box' }),
    annotation(5, { page: 1, type: 'underline', contents: 'Check' })
  ]

  it('lists notes and commented annotations, by page, top to bottom', () => {
    const groups = groupComments(all, 'all')
    expect(groups.map((group) => [group.page, group.annotations.map((a) => a.annotId)])).toEqual([
      [1, [4, 5]],
      [2, [3, 1]]
    ])
  })

  it('filters by type, with everything else under "other"', () => {
    const ids = (filter: Parameters<typeof groupComments>[1]): number[] =>
      groupComments(all, filter).flatMap((group) => group.annotations.map((a) => a.annotId))
    expect(ids('note')).toEqual([3])
    expect(ids('highlight')).toEqual([1])
    expect(ids('underline')).toEqual([5])
    expect(ids('strikeout')).toEqual([])
    expect(ids('other')).toEqual([4])
  })

  it('replaces the annotations of changed pages', () => {
    const merged = mergePages(all, new Set([1, 3]), [annotation(9, { page: 1 })])
    expect(merged.map((a) => a.annotId)).toEqual([2, 9, 1, 3])
  })
})
