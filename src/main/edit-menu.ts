import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

/**
 * The right-click menu for a text field (form fields on the page, the
 * assistant's input, dialog inputs). Electron shows no menu of its own, so
 * without this there is no way to paste with the mouse.
 *
 * Returns null where no menu belongs: anything that is not editable is left
 * to the renderer (the page's selection menu handles selected page text).
 */
export function editMenuTemplate(
  params: Pick<ContextMenuParams, 'isEditable' | 'editFlags' | 'formControlType'>
): MenuItemConstructorOptions[] | null {
  if (!params.isEditable) return null
  const flags = params.editFlags
  // A password's text never leaves the field.
  const secret = params.formControlType === 'input-password'
  return [
    { role: 'cut', enabled: flags.canCut && !secret },
    { role: 'copy', enabled: flags.canCopy && !secret },
    { role: 'paste', enabled: flags.canPaste },
    { role: 'delete', enabled: flags.canDelete },
    { type: 'separator' },
    { role: 'selectAll', enabled: flags.canSelectAll }
  ]
}
