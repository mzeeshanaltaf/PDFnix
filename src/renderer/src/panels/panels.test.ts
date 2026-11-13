import { describe, expect, it } from 'vitest'
import type { OutlineEntry, SearchHit } from '@/api/engine'
import { formatBytes, formatPageSize } from '@/dialogs/format'
import { buildOutlineTree, currentOutlineEntry } from './outlineTree'
import { groupHits } from './searchRows'

describe('outline tree', () => {
  const entries: OutlineEntry[] = [
    { title: 'One', page: 0, level: 1 },
    { title: 'One.A', page: 1, level: 2 },
    { title: 'One.A.i', page: 2, level: 3 },
    { title: 'One.B', page: 4, level: 2 },
    { title: 'Two', page: 6, level: 1 },
    { title: 'Two deep', page: 7, level: 3 }
  ]

  it('nests entries by level', () => {
    const tree = buildOutlineTree(entries)
    expect(tree.map((node) => node.title)).toEqual(['One', 'Two'])
    expect(tree[0].children.map((node) => node.title)).toEqual(['One.A', 'One.B'])
    expect(tree[0].children[0].children.map((node) => node.title)).toEqual(['One.A.i'])
  })

  it('attaches an entry that skips a level to the deepest parent there is', () => {
    const tree = buildOutlineTree(entries)
    expect(tree[1].children.map((node) => node.title)).toEqual(['Two deep'])
  })

  it('finds the entry being read', () => {
    expect(currentOutlineEntry(entries, 0)).toBe(0)
    expect(currentOutlineEntry(entries, 3)).toBe(2)
    expect(currentOutlineEntry(entries, 5)).toBe(3)
    expect(currentOutlineEntry(entries, 100)).toBe(5)
    expect(currentOutlineEntry([{ title: 'x', page: null, level: 1 }], 3)).toBeNull()
  })
})

describe('search result rows', () => {
  const hit = (page: number): SearchHit => ({
    page,
    quads: [],
    before: '',
    match: 'x',
    after: ''
  })

  it('puts a heading before the hits of each page', () => {
    const rows = groupHits([hit(0), hit(0), hit(3)])
    expect(
      rows.map((row) => (row.kind === 'page' ? `p${row.page}:${row.count}` : row.index))
    ).toEqual(['p0:2', 0, 1, 'p3:1', 2])
  })
})

describe('properties formatting', () => {
  it('formats file sizes', () => {
    expect(formatBytes(512)).toBe('512 bytes')
    expect(formatBytes(1_517_312)).toBe('1.45 MB (1,517,312 bytes)')
  })

  it('names common paper sizes in either orientation', () => {
    expect(formatPageSize(595, 842)).toBe('210 × 297 mm (A4, portrait)')
    expect(formatPageSize(792, 612)).toBe('279 × 216 mm (Letter, landscape)')
    expect(formatPageSize(500, 500)).toBe('176 × 176 mm')
  })
})
