/**
 * Pure helpers of the form layer: which fields take input, the order Tab
 * moves through them, and how big their text is on screen.
 */

import type { FieldValueType, FormField } from '@/api/engine'
import { cssScale } from './geometry'

/** Text in an automatically sized single-line field: this share of its height. */
const AUTO_SIZE_SHARE = 0.68
/** Automatic text size limits, in points. */
const AUTO_MIN_PT = 6
const AUTO_MAX_PT = 12
/** Multi-line and list fields with automatic size use this, in points. */
const AUTO_BLOCK_PT = 10

/** Fields the user can change (signatures and buttons are shown but not filled). */
export function isFillable(field: FormField): boolean {
  return !field.flags.readOnly && field.type !== 'signature' && field.type !== 'button'
}

/**
 * The fields Tab visits, in document order: page by page, and on each page
 * in the order the document lists them (which is how PDF forms define tab
 * order unless the page says otherwise).
 */
export function tabOrder(fields: readonly FormField[]): FormField[] {
  return fields
    .map((field, position) => ({ field, position }))
    .filter(({ field }) => isFillable(field))
    .sort((a, b) => a.field.page - b.field.page || a.position - b.position)
    .map(({ field }) => field)
}

/** The field after (or before) `currentId` in tab order, wrapping around. */
export function nextField(
  fields: readonly FormField[],
  currentId: number,
  backwards: boolean
): FormField | null {
  const order = tabOrder(fields)
  if (order.length === 0) return null
  const index = order.findIndex((field) => field.fieldId === currentId)
  if (index === -1) return order[backwards ? order.length - 1 : 0]
  const next = (index + (backwards ? -1 : 1) + order.length) % order.length
  return order[next]
}

/** Font size in CSS pixels for a field's text at `zoom`. */
export function fieldFontPx(field: FormField, zoom: number): number {
  const scale = cssScale(zoom)
  if (field.fontSize > 0) return field.fontSize * scale
  const height = field.rect[3] - field.rect[1]
  const block = field.flags.multiline || field.type === 'listbox'
  const points = block
    ? AUTO_BLOCK_PT
    : Math.min(AUTO_MAX_PT, Math.max(AUTO_MIN_PT, height * AUTO_SIZE_SHARE))
  return points * scale
}

/** Values compare equal: lists by content. */
export function sameValue(a: FieldValueType, b: FieldValueType): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index])
  }
  return a === b
}

/** Text fields: the value as a string (the engine sends "" for empty). */
export function textValue(value: FieldValueType): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Collects changed values and sends them together: a change replaces any
 * earlier one for the same field. `flush` hands over what was collected.
 */
export class ValueBatch {
  private values = new Map<number, FieldValueType>()

  set(fieldId: number, value: FieldValueType): void {
    this.values.set(fieldId, value)
  }

  get size(): number {
    return this.values.size
  }

  has(fieldId: number): boolean {
    return this.values.has(fieldId)
  }

  flush(): { fieldId: number; value: FieldValueType }[] {
    const out = [...this.values].map(([fieldId, value]) => ({ fieldId, value }))
    this.values.clear()
    return out
  }
}
