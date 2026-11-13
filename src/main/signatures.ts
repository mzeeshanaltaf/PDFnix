/**
 * The signature and initials library on disk: `<userData>/signatures/`
 * holds `index.json` and one transparent PNG per entry. Only main touches
 * these files; the renderer works through `window.api.signatures`.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { NewSignature, SignatureEntry } from '../shared/api'
import {
  cleanName,
  isEntryId,
  isSignatureKind,
  MAX_PNG_BYTES,
  parseIndex,
  pngSize,
  withAdded,
  withDefault,
  withRemoved,
  type IndexEntry
} from './signature-library'

function folder(): string {
  return join(app.getPath('userData'), 'signatures')
}

async function readIndex(): Promise<IndexEntry[]> {
  try {
    return parseIndex(await readFile(join(folder(), 'index.json'), 'utf8'))
  } catch {
    return []
  }
}

/** Writes the index atomically (temporary file, then rename). */
async function writeIndex(entries: IndexEntry[]): Promise<void> {
  await mkdir(folder(), { recursive: true })
  const target = join(folder(), 'index.json')
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(entries, null, 2), 'utf8')
  await rename(temporary, target)
}

/** Changes are applied one after another so two cannot overwrite each other. */
let queue: Promise<unknown> = Promise.resolve()

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

export async function listSignatures(): Promise<SignatureEntry[]> {
  const entries = await readIndex()
  const result: SignatureEntry[] = []
  for (const entry of entries) {
    try {
      const png = await readFile(join(folder(), `${entry.id}.png`))
      result.push({ ...entry, png: png.toString('base64') })
    } catch {
      // The picture is gone; leave the entry out.
    }
  }
  return result
}

export function addSignature(input: unknown): Promise<SignatureEntry> {
  return serial(async () => {
    const candidate = (
      typeof input === 'object' && input !== null ? input : {}
    ) as Partial<NewSignature>
    if (!isSignatureKind(candidate.kind)) throw new Error('Unknown kind of signature.')
    if (typeof candidate.png !== 'string') throw new Error('No picture was given.')
    const bytes = Buffer.from(candidate.png, 'base64')
    if (bytes.length > MAX_PNG_BYTES) throw new Error('The picture is larger than 5 MB.')
    const size = pngSize(bytes)
    if (!size) throw new Error('The picture is not a PNG.')
    const entry: IndexEntry = {
      id: randomUUID(),
      kind: candidate.kind,
      name: cleanName(candidate.name, candidate.kind === 'signature' ? 'Signature' : 'Initials'),
      isDefault: false,
      ...size,
      createdAt: new Date().toISOString()
    }
    await mkdir(folder(), { recursive: true })
    await writeFile(join(folder(), `${entry.id}.png`), bytes)
    const entries = withAdded(await readIndex(), entry)
    await writeIndex(entries)
    const saved = entries.find((item) => item.id === entry.id) ?? entry
    return { ...saved, png: bytes.toString('base64') }
  })
}

export function renameSignature(id: unknown, name: unknown): Promise<void> {
  return serial(async () => {
    if (!isEntryId(id)) throw new Error('Unknown signature.')
    const entries = await readIndex()
    await writeIndex(
      entries.map((entry) =>
        entry.id === id ? { ...entry, name: cleanName(name, entry.name) } : entry
      )
    )
  })
}

export function removeSignature(id: unknown): Promise<void> {
  return serial(async () => {
    if (!isEntryId(id)) throw new Error('Unknown signature.')
    await writeIndex(withRemoved(await readIndex(), id))
    await rm(join(folder(), `${id}.png`), { force: true })
  })
}

export function setDefaultSignature(id: unknown): Promise<void> {
  return serial(async () => {
    if (!isEntryId(id)) throw new Error('Unknown signature.')
    await writeIndex(withDefault(await readIndex(), id))
  })
}
