/**
 * The user's signatures and initials. Main stores them as transparent PNGs in
 * the app-data folder; this store mirrors the list and remembers which entry
 * the Sign tool is placing.
 */

import { toast } from 'sonner'
import { create } from 'zustand'
import type { SignatureEntry, SignatureKind } from '../../../shared/api'
import { useTools } from './tools'

export interface Placement {
  entryId: string
  /** Put it at the same place on every page. */
  allPages: boolean
}

interface SignaturesState {
  entries: SignatureEntry[]
  loaded: boolean
  placing: Placement | null
  /** The create/manage dialog: which library it shows, or null when closed. */
  dialog: SignatureKind | null
  setEntries: (entries: SignatureEntry[]) => void
  setPlacing: (placing: Placement | null) => void
  showDialog: (kind: SignatureKind | null) => void
}

/**
 * Object URLs for showing the entries' pictures (the page's security policy
 * allows `blob:` images, not `data:` ones), one per entry, made once.
 */
const previews = new Map<string, string>()

/** A URL that shows an entry's picture. */
export function previewUrl(entry: SignatureEntry): string {
  let url = previews.get(entry.id)
  if (!url) {
    const bytes = Uint8Array.from(atob(entry.png), (char) => char.charCodeAt(0))
    url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    previews.set(entry.id, url)
  }
  return url
}

function forgetPreviews(keep: SignatureEntry[]): void {
  const ids = new Set(keep.map((entry) => entry.id))
  for (const [id, url] of previews) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(url)
      previews.delete(id)
    }
  }
}

export const useSignatures = create<SignaturesState>((set) => ({
  entries: [],
  loaded: false,
  placing: null,
  dialog: null,
  setEntries: (entries) => {
    forgetPreviews(entries)
    set({ entries, loaded: true })
  },
  setPlacing: (placing) => set({ placing }),
  showDialog: (kind) => set({ dialog: kind })
}))

function report(what: string, error: unknown): void {
  toast.error(what, { description: error instanceof Error ? error.message : String(error) })
}

export async function loadSignatures(): Promise<void> {
  try {
    useSignatures.getState().setEntries(await window.api.signatures.list())
  } catch (error) {
    report('Could not load your signatures', error)
  }
}

export function entriesOf(entries: SignatureEntry[], kind: SignatureKind): SignatureEntry[] {
  return entries.filter((entry) => entry.kind === kind)
}

/** The entry marked as default, else the newest, of a kind. */
export function defaultEntry(
  entries: SignatureEntry[],
  kind: SignatureKind
): SignatureEntry | null {
  const own = entriesOf(entries, kind)
  return own.find((entry) => entry.isDefault) ?? own[own.length - 1] ?? null
}

/**
 * Arms the Sign tool with the default signature or initials (or `entryId`).
 * Without any entry of that kind, opens the dialog to create one first.
 */
export async function armSignature(
  kind: SignatureKind,
  options: { entryId?: string; allPages?: boolean } = {}
): Promise<void> {
  const state = useSignatures.getState()
  if (!state.loaded) await loadSignatures()
  const entries = useSignatures.getState().entries
  const entry = options.entryId
    ? entries.find((candidate) => candidate.id === options.entryId)
    : defaultEntry(entries, kind)
  if (!entry) {
    useSignatures.getState().showDialog(kind)
    return
  }
  useSignatures.getState().setPlacing({ entryId: entry.id, allPages: options.allPages ?? false })
  useTools.getState().setActiveTool('signature')
  toast(`Click on the page to place your ${kind === 'signature' ? 'signature' : 'initials'}`, {
    description: options.allPages
      ? 'They will be placed at the same spot on every page.'
      : undefined
  })
}

export async function addSignature(
  kind: SignatureKind,
  name: string,
  png: string
): Promise<SignatureEntry | null> {
  try {
    const entry = await window.api.signatures.add({ kind, name, png })
    await loadSignatures()
    return entry
  } catch (error) {
    report('Could not save the signature', error)
    return null
  }
}

export async function renameSignature(id: string, name: string): Promise<void> {
  try {
    await window.api.signatures.rename(id, name)
  } catch (error) {
    report('Could not rename it', error)
  }
  await loadSignatures()
}

export async function removeSignature(id: string): Promise<void> {
  try {
    await window.api.signatures.remove(id)
  } catch (error) {
    report('Could not delete it', error)
  }
  if (useSignatures.getState().placing?.entryId === id) useSignatures.getState().setPlacing(null)
  await loadSignatures()
}

export async function setDefaultSignature(id: string): Promise<void> {
  try {
    await window.api.signatures.setDefault(id)
  } catch (error) {
    report('Could not change the default', error)
  }
  await loadSignatures()
}
