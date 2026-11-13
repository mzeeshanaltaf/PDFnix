/**
 * Page management from the organiser, the menu and the dialogs: move, delete,
 * duplicate, rotate, insert, extract, split and merge. In-document changes go
 * through `mutate` and are undoable; extract, split and merge write new files.
 */

import { toast } from 'sonner'
import { EngineApiError, engine, type SplitRequest, type WrittenFile } from '../api/engine'
import { formatPageRanges } from '../lib/pageRanges'
import { openPath, withPassword } from './documents'
import { mutate } from './edits'
import { commitPending } from './pending'
import { getTab } from './tabs'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function folderOf(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return index > 0 ? path.slice(0, index) : path
}

function stemOf(path: string): string {
  return baseName(path).replace(/\.pdf$/i, '')
}

function joinPath(folder: string, name: string): string {
  return `${folder.replace(/[\\/]+$/, '')}\\${name}`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Toast for a written file, with "Open" and "Show in folder". */
function announceWritten(file: WrittenFile, message: string): void {
  toast.success(message, {
    description: file.fileName,
    action: { label: 'Open', onClick: () => void openPath(file.path) },
    cancel: { label: 'Show in folder', onClick: () => window.api.files.showInFolder(file.path) }
  })
}

export async function movePages(tabId: string, order: number[]): Promise<boolean> {
  await commitPending()
  const result = await mutate(
    tabId,
    (docId) => engine.reorderPages(docId, order),
    'Could not move the pages'
  )
  return result !== null
}

export async function deletePages(tabId: string, pages: number[]): Promise<boolean> {
  const tab = getTab(tabId)
  if (!tab || pages.length === 0) return false
  if (pages.length >= tab.pageCount) {
    toast.error('A document must keep at least one page')
    return false
  }
  await commitPending()
  const result = await mutate(
    tabId,
    (docId) => engine.deletePages(docId, pages),
    'Could not delete the pages'
  )
  return result !== null
}

export async function duplicatePages(tabId: string, pages: number[]): Promise<boolean> {
  if (pages.length === 0) return false
  await commitPending()
  const result = await mutate(
    tabId,
    (docId) => engine.duplicatePages(docId, pages),
    'Could not duplicate the pages'
  )
  return result !== null
}

export async function rotateSome(tabId: string, pages: number[], degrees: 90 | -90): Promise<void> {
  if (pages.length === 0) return
  await mutate(tabId, (docId) => engine.rotatePages(docId, degrees, pages), 'Could not rotate')
}

/** Blank pages before index `at`, sized like their neighbour. */
export async function insertBlank(tabId: string, at: number, count = 1): Promise<boolean> {
  await commitPending()
  const result = await mutate(
    tabId,
    (docId) => engine.insertBlankPages(docId, at, count),
    'Could not insert the page'
  )
  return result !== null
}

/**
 * Inserts another PDF before index `at`; asks for the file when `path` is not
 * given and for its password if it has one.
 */
export async function insertFromFile(tabId: string, at: number, path?: string): Promise<boolean> {
  let file = path
  if (!file) {
    const chosen = await window.api.files.choose('pdf', 'Insert Pages from File')
    if (chosen.length === 0) return false
    file = chosen[0]
  }
  const source = file
  await commitPending()
  const result = await mutate(
    tabId,
    async (docId) => {
      const answer = await withPassword(baseName(source), (password) =>
        engine.insertPdf(docId, source, at, password === undefined ? {} : { password })
      )
      if (answer === null) throw new Cancelled()
      return answer.result
    },
    'Could not insert the pages',
    { ignore: (error) => error instanceof Cancelled }
  )
  return result !== null
}

/** The user cancelled a password prompt; nothing to report. */
class Cancelled extends Error {
  constructor() {
    super('Cancelled')
  }
}

/** Writes `pages` to a new file chosen with Save As. */
export async function extractPages(tabId: string, pages: number[]): Promise<void> {
  const tab = getTab(tabId)
  if (!tab || pages.length === 0) return
  await commitPending()
  const suggested = joinPath(
    folderOf(tab.filePath),
    `${stemOf(tab.filePath)} (pages ${formatPageRanges(pages).replace(/, /g, ',')}).pdf`
  )
  const target = await window.api.files.showSaveDialog(suggested, 'Extract Pages')
  if (!target) return
  try {
    const written = await engine.extractPages(tab.docId, pages, target)
    announceWritten(written, `Extracted ${plural(written.pageCount, 'page')}`)
  } catch (error) {
    toast.error('Could not extract the pages', { description: describe(error) })
  }
}

export interface SplitOutcome {
  files: WrittenFile[]
}

/**
 * Splits the document into files in `outDir`. If some exist, asks before
 * replacing them (`confirmOverwrite` returns true to go ahead).
 */
export async function splitDocument(
  tabId: string,
  split: SplitRequest,
  outDir: string,
  nameTemplate: string,
  confirmOverwrite: (paths: string[]) => Promise<boolean>
): Promise<SplitOutcome | null> {
  const tab = getTab(tabId)
  if (!tab) return null
  await commitPending()
  try {
    return await engine.split(tab.docId, split, outDir, nameTemplate)
  } catch (error) {
    if (error instanceof EngineApiError && error.code === 'files_exist') {
      const paths = Array.isArray(error.details.paths) ? (error.details.paths as string[]) : []
      if (!(await confirmOverwrite(paths))) return null
      return await engine.split(tab.docId, split, outDir, nameTemplate, true)
    }
    throw error
  }
}

export interface MergeItem {
  path: string
  /** 0-based pages in order; undefined for all. */
  pages?: number[]
  password?: string
}

/**
 * Merges `items` into `outPath`, asking for the passwords of protected files
 * as the engine reports them. Null if the user cancelled a password prompt.
 */
export async function mergeFiles(items: MergeItem[], outPath: string): Promise<WrittenFile | null> {
  const passwords = new Map<string, string>()
  for (const item of items) if (item.password) passwords.set(item.path, item.password)
  for (;;) {
    try {
      return await engine.merge(
        items.map((item) => ({
          path: item.path,
          ...(item.pages ? { pages: item.pages } : {}),
          ...(passwords.has(item.path) ? { password: passwords.get(item.path) } : {})
        })),
        outPath
      )
    } catch (error) {
      if (
        !(error instanceof EngineApiError) ||
        (error.code !== 'password_required' && error.code !== 'password_incorrect') ||
        typeof error.details.path !== 'string'
      ) {
        throw error
      }
      const path = error.details.path
      const answer = await withPassword(baseName(path), async (password) => {
        if (password === undefined) throw error
        return password
      })
      if (answer === null) return null
      passwords.set(path, answer.result)
    }
  }
}

export { announceWritten, baseName, folderOf, joinPath, stemOf }
