import { describe, expect, it } from 'vitest'
import {
  cleanName,
  isEntryId,
  parseIndex,
  pngSize,
  withAdded,
  withDefault,
  withRemoved,
  type IndexEntry
} from './signature-library'

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13], 8)
  bytes.set(
    [...'IHDR'].map((char) => char.charCodeAt(0)),
    12
  )
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function entry(id: string, kind: 'signature' | 'initials', isDefault = false): IndexEntry {
  return { id, kind, name: id, isDefault, width: 10, height: 5, createdAt: '2026-11-13T00:00:00Z' }
}

describe('pngSize', () => {
  it('reads the size of a PNG', () => {
    expect(pngSize(png(320, 120))).toEqual({ width: 320, height: 120 })
  })

  it('refuses anything else', () => {
    expect(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull()
    const broken = png(10, 10)
    broken[12] = 0x41
    expect(pngSize(broken)).toBeNull()
    expect(pngSize(png(0, 10))).toBeNull()
  })
})

describe('the index', () => {
  const a = 'aaaaaaaa-0000-0000-0000-000000000001'
  const b = 'bbbbbbbb-0000-0000-0000-000000000002'
  const c = 'cccccccc-0000-0000-0000-000000000003'

  it('makes the first entry of a kind its default', () => {
    let entries = withAdded([], entry(a, 'signature'))
    entries = withAdded(entries, entry(b, 'signature'))
    entries = withAdded(entries, entry(c, 'initials'))
    expect(entries.map((item) => item.isDefault)).toEqual([true, false, true])
  })

  it('keeps one default per kind', () => {
    const entries = withDefault(
      [entry(a, 'signature', true), entry(b, 'signature'), entry(c, 'initials', true)],
      b
    )
    expect(entries.map((item) => item.isDefault)).toEqual([false, true, true])
  })

  it('hands the default on when it is removed', () => {
    const entries = withRemoved(
      [entry(a, 'signature', true), entry(b, 'signature'), entry(c, 'initials', true)],
      a
    )
    expect(entries.map((item) => [item.id, item.isDefault])).toEqual([
      [b, true],
      [c, true]
    ])
  })

  it('drops malformed index entries', () => {
    const text = JSON.stringify([entry(a, 'signature'), { id: '../x', kind: 'signature' }, 5])
    expect(parseIndex(text).map((item) => item.id)).toEqual([a])
    expect(parseIndex('not json')).toEqual([])
  })

  it('only accepts ids that are safe file names', () => {
    expect(isEntryId(a)).toBe(true)
    expect(isEntryId('../../evil')).toBe(false)
  })

  it('cleans names', () => {
    expect(cleanName('  Jane   Doe ', 'x')).toBe('Jane Doe')
    expect(cleanName('', 'Signature')).toBe('Signature')
    expect(cleanName('x'.repeat(200), 'y')).toHaveLength(80)
  })
})
