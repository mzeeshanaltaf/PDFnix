import { describe, expect, it } from 'vitest'
import type { FormField } from '@/api/engine'
import { fieldFontPx, isFillable, nextField, sameValue, tabOrder, ValueBatch } from './formFields'

const FLAGS: FormField['flags'] = {
  readOnly: false,
  required: false,
  multiline: false,
  password: false,
  comb: false,
  editable: false,
  multiSelect: false,
  noToggleToOff: false
}

function field(fieldId: number, page: number, extra: Partial<FormField> = {}): FormField {
  return {
    fieldId,
    page,
    rect: [0, 0, 100, 20],
    type: 'text',
    name: `f${fieldId}`,
    label: '',
    value: '',
    flags: FLAGS,
    fontSize: 0,
    textColor: '#000000',
    align: 'left',
    ...extra
  }
}

describe('fillable fields and tab order', () => {
  const fields = [
    field(10, 1),
    field(3, 0),
    field(4, 0, { type: 'signature' }),
    field(5, 0, { flags: { ...FLAGS, readOnly: true } }),
    field(6, 0, { type: 'checkbox' }),
    field(11, 1, { type: 'radio' }),
    field(12, 1, { type: 'radio' })
  ]

  it('skips signatures, buttons and read-only fields', () => {
    expect(isFillable(field(1, 0, { type: 'button' }))).toBe(false)
    expect(isFillable(fields[2])).toBe(false)
    expect(isFillable(fields[3])).toBe(false)
    expect(isFillable(fields[4])).toBe(true)
  })

  it('goes page by page, in document order within a page', () => {
    expect(tabOrder(fields).map((f) => f.fieldId)).toEqual([3, 6, 10, 11, 12])
  })

  it('Tab and Shift+Tab move along and wrap around', () => {
    expect(nextField(fields, 6, false)?.fieldId).toBe(10)
    expect(nextField(fields, 10, true)?.fieldId).toBe(6)
    expect(nextField(fields, 12, false)?.fieldId).toBe(3)
    expect(nextField(fields, 3, true)?.fieldId).toBe(12)
    // From somewhere that is not a field: the first (or last).
    expect(nextField(fields, 999, false)?.fieldId).toBe(3)
    expect(nextField(fields, 999, true)?.fieldId).toBe(12)
    expect(nextField([], 1, false)).toBeNull()
  })
})

describe('fieldFontPx', () => {
  it('uses the field size, scaled to the zoom', () => {
    // 10 pt at 100 % is 10 × 96/72 px.
    expect(fieldFontPx(field(1, 0, { fontSize: 10 }), 1)).toBeCloseTo(13.333, 2)
    expect(fieldFontPx(field(1, 0, { fontSize: 10 }), 2)).toBeCloseTo(26.667, 2)
  })

  it('sizes automatic single-line text to the field height, within limits', () => {
    // 20 pt high: 13.6 pt, capped at 12 pt.
    expect(fieldFontPx(field(1, 0), 1)).toBeCloseTo(16, 5)
    // 12 pt high: 8.16 pt.
    expect(fieldFontPx(field(1, 0, { rect: [0, 0, 100, 12] }), 1)).toBeCloseTo(8.16 * (96 / 72), 4)
    // Tiny fields do not go below 6 pt.
    expect(fieldFontPx(field(1, 0, { rect: [0, 0, 100, 4] }), 1)).toBeCloseTo(8, 5)
  })

  it('uses a fixed size for automatic multi-line text and lists', () => {
    const multiline = field(1, 0, { rect: [0, 0, 100, 80], flags: { ...FLAGS, multiline: true } })
    expect(fieldFontPx(multiline, 1)).toBeCloseTo(10 * (96 / 72), 5)
  })
})

describe('values', () => {
  it('compares lists by content', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameValue(['a'], ['a', 'b'])).toBe(false)
    expect(sameValue('x', 'x')).toBe(true)
    expect(sameValue(true, false)).toBe(false)
    expect(sameValue(null, null)).toBe(true)
  })

  it('batches the latest value per field', () => {
    const batch = new ValueBatch()
    batch.set(1, 'a')
    batch.set(2, true)
    batch.set(1, 'b')
    expect(batch.size).toBe(2)
    expect(batch.flush()).toEqual([
      { fieldId: 1, value: 'b' },
      { fieldId: 2, value: true }
    ])
    expect(batch.size).toBe(0)
  })
})
