import { memo, useState } from 'react'
import { cn } from 'cn'
import type { FieldValueType, FormField } from '@/api/engine'
import { queueFieldValue, useFieldsOnPage, useForms } from '@/state/forms'
import { getViewer } from './controller'
import { fieldFontPx, isFillable, nextField, sameValue, textValue } from './formFields'
import { rectToPx } from './geometry'

/** How many frames to wait for the page of the next field to appear. */
const FOCUS_FRAMES = 60

function fieldElement(fieldId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.pdf-form-layer [data-field-id="${fieldId}"]`)
}

/**
 * Tab and Shift+Tab move through the document's fields in order, also to
 * fields on pages that are not on screen yet (the viewer goes there first).
 */
function moveFocus(tabId: string, field: FormField, backwards: boolean): void {
  const fields = useForms.getState().fields[tabId]?.fields ?? []
  const next = nextField(fields, field.fieldId, backwards)
  if (!next) return
  const now = fieldElement(next.fieldId)
  if (now) {
    now.focus()
    return
  }
  getViewer(tabId)?.goToPage(next.page)
  let frames = 0
  const tryFocus = (): void => {
    const element = fieldElement(next.fieldId)
    if (element) element.focus()
    else if (++frames < FOCUS_FRAMES) requestAnimationFrame(tryFocus)
  }
  requestAnimationFrame(tryFocus)
}

interface FieldProps {
  tabId: string
  field: FormField
  zoom: number
  highlight: boolean
}

function onTab(tabId: string, field: FormField) {
  return (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || event.ctrlKey || event.altKey) return
    event.preventDefault()
    moveFocus(tabId, field, event.shiftKey)
  }
}

/** Text fields keep what is typed until they lose focus, then send it. */
function TextField({
  tabId,
  field,
  zoom,
  list
}: FieldProps & { list?: string }): React.JSX.Element {
  const engineValue = textValue(field.value)
  const [draft, setDraft] = useState(engineValue)
  const [focused, setFocused] = useState(false)
  // A newer value from the engine (undo, reset) replaces the draft unless the
  // field is being typed in (adjusted while rendering, not in an effect).
  const [synced, setSynced] = useState(engineValue)
  if (!focused && engineValue !== synced) {
    setSynced(engineValue)
    setDraft(engineValue)
  }

  // While typing, or until the engine has drawn what was typed, the input
  // shows its own text; otherwise the page image shows the value.
  const showOwn = focused || draft !== engineValue
  const style: React.CSSProperties = {
    fontSize: fieldFontPx(field, zoom),
    color: showOwn ? field.textColor : 'transparent',
    textAlign: field.align,
    letterSpacing:
      field.flags.comb && field.maxLength
        ? `calc(${rectToPx(field.rect, zoom).width / field.maxLength}px - 0.6em)`
        : undefined
  }
  const common = {
    'data-field-id': field.fieldId,
    'aria-label': field.label || field.name,
    'aria-required': field.flags.required || undefined,
    value: draft,
    maxLength: field.maxLength,
    spellCheck: false,
    className: cn('pdf-form-input', showOwn && 'own'),
    style,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      if (draft !== engineValue) queueFieldValue(tabId, field.fieldId, draft)
    },
    onKeyDown: onTab(tabId, field)
  }
  if (field.flags.multiline) {
    return <textarea {...common} onChange={(event) => setDraft(event.target.value)} />
  }
  return (
    <input
      {...common}
      list={list}
      type={field.flags.password ? 'password' : 'text'}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else onTab(tabId, field)(event)
      }}
    />
  )
}

/** Checkboxes and radio buttons: the page image shows the state; this takes the click. */
function ButtonField({ tabId, field }: FieldProps): React.JSX.Element {
  const checked =
    field.type === 'checkbox'
      ? field.value === true
      : field.value !== null && field.value === field.exportValue
  return (
    <input
      type={field.type === 'checkbox' ? 'checkbox' : 'radio'}
      name={field.type === 'radio' ? `${tabId}:${field.name}` : undefined}
      data-field-id={field.fieldId}
      aria-label={
        field.type === 'radio'
          ? `${field.label || field.name}: ${field.exportValue}`
          : field.label || field.name
      }
      aria-required={field.flags.required || undefined}
      checked={checked}
      className="pdf-form-check"
      onChange={() => {
        if (field.type === 'checkbox') queueFieldValue(tabId, field.fieldId, !checked)
        else queueFieldValue(tabId, field.fieldId, field.exportValue ?? null)
      }}
      onClick={(event) => {
        // A radio button that is on turns the group off, unless the form says not to.
        if (field.type === 'radio' && checked && !field.flags.noToggleToOff) {
          event.preventDefault()
          queueFieldValue(tabId, field.fieldId, null)
        }
      }}
      onKeyDown={onTab(tabId, field)}
    />
  )
}

function ChoiceField({ tabId, field, zoom }: FieldProps): React.JSX.Element {
  const options = field.options ?? []
  const multiple = field.type === 'listbox'
  const value = multiple ? (Array.isArray(field.value) ? field.value : []) : textValue(field.value)
  const send = (next: FieldValueType): void => {
    if (!sameValue(next, field.value)) queueFieldValue(tabId, field.fieldId, next)
  }

  if (field.type === 'combobox' && field.flags.editable) {
    const listId = `pdf-field-options-${field.fieldId}`
    return (
      <EditableCombo
        tabId={tabId}
        field={field}
        zoom={zoom}
        highlight={false}
        listId={listId}
        options={options}
      />
    )
  }

  return (
    <select
      data-field-id={field.fieldId}
      aria-label={field.label || field.name}
      aria-required={field.flags.required || undefined}
      multiple={multiple}
      size={multiple ? Math.max(2, options.length) : undefined}
      value={value}
      className={cn('pdf-form-select', multiple && 'list')}
      style={{ fontSize: fieldFontPx(field, zoom), color: field.textColor }}
      onChange={(event) => {
        if (multiple) {
          send(Array.from(event.target.selectedOptions, (option) => option.value))
        } else {
          send(event.target.value)
        }
      }}
      onKeyDown={onTab(tabId, field)}
    >
      {!multiple && !options.some((option) => option.value === value) && (
        <option value={value}>{value}</option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function EditableCombo({
  tabId,
  field,
  zoom,
  listId,
  options
}: FieldProps & {
  listId: string
  options: { value: string; label: string }[]
}): React.JSX.Element {
  return (
    <>
      <TextField tabId={tabId} field={field} zoom={zoom} highlight={false} list={listId} />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </datalist>
    </>
  )
}

const FieldView = memo(function FieldView(props: FieldProps): React.JSX.Element {
  const { field, zoom, highlight } = props
  const box = rectToPx(field.rect, zoom)
  const fillable = isFillable(field)
  return (
    <div
      className={cn(
        'pdf-form-field',
        `type-${field.type}`,
        highlight && 'highlight',
        field.flags.required && 'required',
        !fillable && 'locked'
      )}
      style={box}
      title={
        field.type === 'signature'
          ? 'Signature field: PDFnix cannot sign it with a certificate.'
          : field.flags.readOnly
            ? `${field.label || field.name} (read-only)`
            : field.label || undefined
      }
    >
      {fillable &&
        (field.type === 'text' ? (
          <TextField {...props} />
        ) : field.type === 'checkbox' || field.type === 'radio' ? (
          <ButtonField {...props} />
        ) : (
          <ChoiceField {...props} />
        ))}
    </div>
  )
})

interface FormLayerProps {
  tabId: string
  page: number
  zoom: number
}

/**
 * Real inputs over the page's form fields. The page image shows the values;
 * a text field shows its own text only while it is being typed in.
 */
export const FormLayer = memo(function FormLayer({
  tabId,
  page,
  zoom
}: FormLayerProps): React.JSX.Element | null {
  const fields = useFieldsOnPage(tabId, page)
  const highlight = useForms((state) => state.highlight)
  if (fields.length === 0) return null
  return (
    <div className="pdf-form-layer" data-page-index={page}>
      {fields.map((field) => (
        <FieldView
          key={field.fieldId}
          tabId={tabId}
          field={field}
          zoom={zoom}
          highlight={highlight}
        />
      ))}
    </div>
  )
})
