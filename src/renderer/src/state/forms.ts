/**
 * Interactive forms: the fields of each open document (fetched again after
 * every change), values typed into the form layer (collected and sent when a
 * field loses focus, in one batch), and the form bar's switches.
 */

import { useEffect } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { engine, isAbortError, type FieldValueType, type FormField } from '../api/engine'
import { ValueBatch } from '../viewer/formFields'
import { mutate } from './edits'
import { getTab, useTabs } from './tabs'

interface FieldsEntry {
  docId: string
  revision: number
  fields: FormField[]
}

interface FormsState {
  /** By tab. */
  fields: Record<string, FieldsEntry>
  /** Fields are tinted so they can be found. */
  highlight: boolean
  /** Tabs whose form bar was closed. */
  dismissed: Record<string, true>
  setHighlight: (on: boolean) => void
  dismiss: (tabId: string) => void
}

export const useForms = create<FormsState>((set) => ({
  fields: {},
  highlight: true,
  dismissed: {},
  setHighlight: (on) => set({ highlight: on }),
  dismiss: (tabId) => set((state) => ({ dismissed: { ...state.dismissed, [tabId]: true } }))
}))

const loading = new Map<string, { key: string; controller: AbortController }>()

/** Fetches the fields of a tab's document at its current revision. */
async function loadFields(tabId: string): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  const current = useForms.getState().fields[tabId]
  if (current && current.docId === tab.docId && current.revision === tab.revision) return
  // Every page's form layer asks; one request per revision is enough.
  const key = `${tab.docId}:${tab.revision}`
  const inFlight = loading.get(tabId)
  if (inFlight?.key === key) return
  inFlight?.controller.abort()
  const controller = new AbortController()
  const request = { key, controller }
  loading.set(tabId, request)
  try {
    const fields = await engine.formFields(tab.docId, controller.signal)
    const latest = getTab(tabId)
    if (!latest || latest.docId !== tab.docId) return
    useForms.setState((state) => ({
      fields: { ...state.fields, [tabId]: { docId: tab.docId, revision: tab.revision, fields } }
    }))
  } catch (error) {
    if (!isAbortError(error)) {
      // A document whose fields cannot be read is shown without the form layer.
      useForms.setState((state) => ({
        fields: {
          ...state.fields,
          [tabId]: { docId: tab.docId, revision: tab.revision, fields: [] }
        }
      }))
    }
  } finally {
    if (loading.get(tabId) === request) loading.delete(tabId)
  }
}

/** The fields of a tab's document (loaded as needed), or null while loading. */
export function useFormFields(tabId: string): FormField[] | null {
  const revision = useTabs((state) => state.tabs.find((tab) => tab.id === tabId)?.revision)
  const docId = useTabs((state) => state.tabs.find((tab) => tab.id === tabId)?.docId)
  const entry = useForms((state) => state.fields[tabId])
  useEffect(() => {
    void loadFields(tabId)
  }, [tabId, revision, docId])
  if (!entry || entry.docId !== docId) return null
  return entry.fields
}

/** Fields of one page. */
export function useFieldsOnPage(tabId: string, page: number): FormField[] {
  const fields = useFormFields(tabId)
  return fields ? fields.filter((field) => field.page === page) : NO_FIELDS
}

const NO_FIELDS: FormField[] = []

export function hasFillableFields(fields: readonly FormField[] | null): boolean {
  return (fields ?? []).some(
    (field) => !field.flags.readOnly && field.type !== 'signature' && field.type !== 'button'
  )
}

// --- Sending values ------------------------------------------------------------

const batches = new Map<string, ValueBatch>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Queues a value for a field and sends the queue shortly after (so a value
 * typed and the next field's click go together). Text fields call this when
 * they lose focus, checkboxes and choices when they change.
 */
export function queueFieldValue(tabId: string, fieldId: number, value: FieldValueType): void {
  let batch = batches.get(tabId)
  if (!batch) {
    batch = new ValueBatch()
    batches.set(tabId, batch)
  }
  batch.set(fieldId, value)
  clearTimeout(timers.get(tabId))
  timers.set(
    tabId,
    setTimeout(() => void flushFieldValues(tabId), 0)
  )
}

/** Whether a value for the field is waiting to be sent. */
export function isQueued(tabId: string, fieldId: number): boolean {
  return batches.get(tabId)?.has(fieldId) ?? false
}

/** Sends the queued values of a tab now (before saving, say). */
export async function flushFieldValues(tabId: string): Promise<void> {
  clearTimeout(timers.get(tabId))
  timers.delete(tabId)
  const batch = batches.get(tabId)
  if (!batch || batch.size === 0) return
  const values = batch.flush()
  await mutate(tabId, (docId) => engine.setFieldValues(docId, values), 'Could not fill in the form')
}

/** Sends whatever the focused field holds, then everything queued. */
export async function commitFormInput(tabId: string): Promise<void> {
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('.pdf-form-layer')) active.blur()
  await flushFieldValues(tabId)
}

export async function resetForm(tabId: string): Promise<void> {
  await commitFormInput(tabId)
  const result = await mutate(tabId, (docId) => engine.resetForm(docId), 'Could not reset the form')
  if (result && result.revision === getTab(tabId)?.revision && result.dirtyPages.length === 0) {
    toast.info('The form is already empty')
  }
}

export async function flattenForm(tabId: string): Promise<void> {
  await commitFormInput(tabId)
  const result = await mutate(
    tabId,
    (docId) => engine.flattenForm(docId),
    'Could not flatten the form'
  )
  if (result) {
    toast.success('Form flattened', {
      description: 'The values are now part of the page. Undo brings the fields back.'
    })
  }
}
