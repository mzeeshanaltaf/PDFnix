import type { EditFlags } from 'electron'
import { describe, expect, it } from 'vitest'
import { editMenuTemplate } from './edit-menu'

const all: EditFlags = {
  canUndo: true,
  canRedo: true,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
  canEditRichly: false
}

function enabled(template: ReturnType<typeof editMenuTemplate>): Record<string, boolean> {
  return Object.fromEntries(
    (template ?? []).filter((item) => item.role).map((item) => [item.role, item.enabled])
  )
}

describe('editMenuTemplate', () => {
  it('offers cut, copy, paste, delete and select all in a text field', () => {
    const template = editMenuTemplate({
      isEditable: true,
      editFlags: all,
      formControlType: 'input-text'
    })
    expect(enabled(template)).toEqual({
      cut: true,
      copy: true,
      paste: true,
      delete: true,
      selectAll: true
    })
  })

  it('follows what the field allows: paste stays on with nothing selected', () => {
    const template = editMenuTemplate({
      isEditable: true,
      editFlags: { ...all, canCut: false, canCopy: false, canDelete: false },
      formControlType: 'text-area'
    })
    expect(enabled(template)).toMatchObject({ cut: false, copy: false, paste: true })
  })

  it('never cuts or copies out of a password field', () => {
    const template = editMenuTemplate({
      isEditable: true,
      editFlags: all,
      formControlType: 'input-password'
    })
    expect(enabled(template)).toMatchObject({ cut: false, copy: false, paste: true })
  })

  it('shows nothing outside editable fields', () => {
    expect(
      editMenuTemplate({ isEditable: false, editFlags: all, formControlType: 'none' })
    ).toBeNull()
  })
})
