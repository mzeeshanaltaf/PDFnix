/**
 * The processing tools (phase 6): compress, protect, OCR, conversions and
 * printing. The dialogs collect the options; these functions run the jobs
 * (`state/jobs.ts`), apply what changed and tell the user how it went.
 */

import { toast } from 'sonner'
import {
  EngineApiError,
  engine,
  type CompressParams,
  type CompressResult,
  type ConvertedFile,
  type ImagesResult,
  type OcrParams,
  type OcrResult,
  type ProtectionRequest,
  type SecurityChange
} from '../api/engine'
import type { PrintRequest } from '../../../shared/api'
import { confirmAction } from './dialogs'
import { noteProtectionChange, openPath, saveTab } from './documents'
import { mutate } from './edits'
import { commitFormInput } from './forms'
import { runDocumentJob, runFileJob } from './jobs'
import { baseName, folderOf, joinPath, stemOf } from './pageOps'
import { commitPending } from './pending'
import { getTab, useTabs } from './tabs'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`
}

/** Opens a written file: PDFs in a tab, anything else in its own program. */
export function openWritten(path: string): void {
  if (/\.pdf$/i.test(path)) void openPath(path)
  else
    window.api.files.openExternally(path).catch((error: unknown) => {
      toast.error(`Could not open ${baseName(path)}`, { description: describe(error) })
    })
}

/** "Saved …" toast with Open file and Show in folder. */
export function announceFile(file: { path: string; fileName?: string }, message: string): void {
  toast.success(message, {
    description: file.fileName ?? baseName(file.path),
    duration: 10000,
    action: { label: 'Open file', onClick: () => openWritten(file.path) },
    cancel: { label: 'Show in folder', onClick: () => window.api.files.showInFolder(file.path) }
  })
}

/** Everything placed or typed goes into the document before a job reads it. */
async function settle(tabId: string): Promise<void> {
  await commitPending()
  await commitFormInput(tabId)
}

// --- Compress --------------------------------------------------------------------

/**
 * Compresses the document (replacing it, undoably) or writes a compressed
 * copy. Resolves with the result for the dialog to show, or null.
 */
export async function compressDocument(
  tabId: string,
  params: CompressParams
): Promise<CompressResult | null> {
  await settle(tabId)
  const final = await runDocumentJob<CompressResult>(
    tabId,
    'Compressing',
    'compress',
    params,
    'Could not compress the document'
  )
  if (!final) return null
  if (final.status === 'cancelled') {
    toast('Compression cancelled. The document is unchanged.', { duration: 3000 })
    return null
  }
  // The Compress dialog shows the outcome.
  return final.status === 'done' ? (final.result ?? null) : null
}

// --- Protect ---------------------------------------------------------------------

/** Error from the engine: the owner password is needed (`wrong`: the one given was not it). */
export function ownerPasswordNeeded(error: unknown): { wrong: boolean } | null {
  if (error instanceof EngineApiError && error.code === 'owner_password_required') {
    return { wrong: error.details.wrong === true }
  }
  return null
}

/** Offers to save now, since protection only takes effect when saving. */
function offerSave(tabId: string, message: string): void {
  toast.success(message, {
    description: 'It is applied when you save the document.',
    duration: 8000,
    action: { label: 'Save now', onClick: () => void saveTab(tabId) }
  })
}

/**
 * Sets protection to apply on the next save. Throws the engine's error for
 * the dialog to show (owner password needed or wrong).
 */
export async function protectDocument(tabId: string, request: ProtectionRequest): Promise<void> {
  let failure: unknown = null
  const result = await mutate<SecurityChange>(
    tabId,
    (docId) => engine.setSecurity(docId, request),
    'Could not protect the document',
    {
      ignore: (error) => {
        if (ownerPasswordNeeded(error) === null) return false
        failure = error
        return true
      }
    }
  )
  if (!result) {
    if (failure) throw failure
    return
  }
  noteProtectionChange(tabId, request.userPassword ? request.userPassword : null)
  offerSave(tabId, 'Password protection set')
}

export async function unprotectDocument(tabId: string, currentPassword?: string): Promise<void> {
  let failure: unknown = null
  const result = await mutate<SecurityChange>(
    tabId,
    (docId) => engine.removeSecurity(docId, currentPassword),
    'Could not remove the protection',
    {
      ignore: (error) => {
        if (ownerPasswordNeeded(error) === null) return false
        failure = error
        return true
      }
    }
  )
  if (!result) {
    if (failure) throw failure
    return
  }
  if (result.pending === null) {
    // An unsaved protection was taken back: the file keeps what it has.
    noteProtectionChange(tabId, undefined)
    toast('Protection not applied', { duration: 3000 })
  } else {
    noteProtectionChange(tabId, null)
    offerSave(tabId, 'Password protection will be removed')
  }
}

// --- OCR -------------------------------------------------------------------------

export async function recogniseText(tabId: string, params: OcrParams): Promise<boolean> {
  await settle(tabId)
  const final = await runDocumentJob<OcrResult>(
    tabId,
    'Recognising text',
    'ocr',
    params,
    'Could not recognise the text'
  )
  if (!final) return false
  if (final.status === 'cancelled') {
    toast('Text recognition cancelled. The document is unchanged.', { duration: 3000 })
    return false
  }
  const result = final.status === 'done' ? final.result : undefined
  if (!result) return false
  useTabs.getState().patchTab(tabId, { hasTextLayer: result.hasTextLayer })
  if (result.pagesProcessed === 0) {
    toast.info('Every page already has text', {
      description: `${plural(result.pagesSkipped, 'page')} skipped. Untick “Skip pages that already have text” to recognise them anyway.`
    })
  } else if (result.wordsFound === 0) {
    toast.warning('No text was found', {
      description: 'The pages may be blank, too faint, or in another language.'
    })
  } else {
    toast.success(
      `Recognised ${plural(result.wordsFound, 'word')} on ${plural(result.pagesProcessed, 'page')}`,
      {
        description:
          (result.pagesSkipped > 0
            ? `${plural(result.pagesSkipped, 'page')} with text skipped. `
            : '') + 'The text can now be searched and copied. Save to keep it.'
      }
    )
  }
  return true
}

/** Downloads one OCR language; resolves to whether it is now installed. */
export async function downloadLanguage(code: string, name: string): Promise<boolean> {
  const final = await runFileJob(
    `Downloading ${name}`,
    'ocr-language',
    null,
    { code },
    `Could not download ${name}`
  )
  return final !== null
}

// --- Conversions -----------------------------------------------------------------

export async function convertToWord(tabId: string, pages?: number[]): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  const target = await window.api.files.showSaveDialog(
    joinPath(folderOf(tab.filePath), `${stemOf(tab.filePath)}.docx`),
    'Save as Word Document',
    'docx'
  )
  if (!target) return
  await settle(tabId)
  const final = await runFileJob<ConvertedFile & { failedPages: number }>(
    'Converting to Word',
    'pdf-to-docx',
    tab.docId,
    { outPath: target, ...(pages ? { pages } : {}) },
    'Could not convert to Word'
  )
  if (!final?.result) return
  announceFile(
    final.result,
    final.result.failedPages > 0
      ? `Converted, but ${plural(final.result.failedPages, 'page')} could not be converted`
      : 'Converted to Word'
  )
}

export async function convertToText(
  tabId: string,
  pages: number[] | undefined,
  layout: boolean
): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  const target = await window.api.files.showSaveDialog(
    joinPath(folderOf(tab.filePath), `${stemOf(tab.filePath)}.txt`),
    'Save as Text',
    'txt'
  )
  if (!target) return
  await settle(tabId)
  const final = await runFileJob<ConvertedFile>(
    'Saving as text',
    'pdf-to-text',
    tab.docId,
    { outPath: target, layout, ...(pages ? { pages } : {}) },
    'Could not save the text'
  )
  if (final?.result) announceFile(final.result, 'Text saved')
}

export interface ImageExport {
  pages?: number[]
  format: 'png' | 'jpg'
  dpi: number
  outDir: string
}

/** Exports pages as pictures; asks before replacing files that exist. */
export async function convertToImages(tabId: string, options: ImageExport): Promise<boolean> {
  const tab = getTab(tabId)
  if (!tab) return false
  await settle(tabId)
  let overwrite = false
  for (;;) {
    let exists: string[] | null = null
    const final = await runFileJob<ImagesResult>(
      'Exporting pages',
      'pdf-to-images',
      tab.docId,
      { ...options, overwrite },
      'Could not export the pages',
      (error) => {
        if (error instanceof EngineApiError && error.code === 'files_exist') {
          exists = Array.isArray(error.details.paths) ? (error.details.paths as string[]) : []
          return true
        }
        return false
      }
    )
    if (exists !== null && !overwrite) {
      const paths: string[] = exists
      const yes = await confirmAction({
        title: 'Replace existing pictures?',
        message: `${paths.length === 1 ? 'This file exists' : `These ${paths.length} files exist`} in the folder already.`,
        details: paths
          .slice(0, 8)
          .concat(paths.length > 8 ? [`… and ${paths.length - 8} more`] : []),
        confirmLabel: 'Replace',
        destructive: true
      })
      if (!yes) return false
      overwrite = true
      continue
    }
    const result = final?.result
    if (!result) return false
    const first = result.files[0]
    toast.success(
      `Exported ${plural(result.files.length, 'page')} as ${options.format.toUpperCase()}`,
      {
        description: result.folder,
        duration: 10000,
        action: first ? { label: 'Open file', onClick: () => openWritten(first.path) } : undefined,
        cancel: first
          ? { label: 'Show in folder', onClick: () => window.api.files.showInFolder(first.path) }
          : undefined
      }
    )
    return true
  }
}

export interface ImagesToPdfOptions {
  pageSize: 'image' | 'a4' | 'letter'
  orientation: 'auto' | 'portrait' | 'landscape'
  margin: number
}

export async function imagesToPdf(inputs: string[], options: ImagesToPdfOptions): Promise<boolean> {
  if (inputs.length === 0) return false
  const target = await window.api.files.showSaveDialog(
    joinPath(folderOf(inputs[0]), `${stemOf(baseName(inputs[0])).replace(/\.[^.]+$/, '')}.pdf`),
    'Save PDF'
  )
  if (!target) return false
  const final = await runFileJob<ConvertedFile>(
    'Making a PDF',
    'images-to-pdf',
    null,
    { inputs, ...options, outPath: target },
    'Could not make the PDF'
  )
  if (!final?.result) return false
  announceFile(
    final.result,
    `PDF made from ${plural(final.result.pageCount ?? inputs.length, 'picture')}`
  )
  return true
}

/** Word to PDF: choose a Word document, then where to save the PDF. */
export async function wordToPdf(): Promise<void> {
  const chosen = await window.api.files.choose('word', 'Convert Word Document to PDF')
  if (chosen.length === 0) return
  const source = chosen[0]
  const target = await window.api.files.showSaveDialog(
    joinPath(folderOf(source), `${baseName(source).replace(/\.[^.]+$/, '')}.pdf`),
    'Save PDF'
  )
  if (!target) return
  const final = await runFileJob<ConvertedFile & { converter: string }>(
    'Converting Word document',
    'docx-to-pdf',
    null,
    { input: source, outPath: target },
    `Could not convert ${baseName(source)}`
  )
  if (final?.result) announceFile(final.result, 'Converted to PDF')
}

// --- Print -----------------------------------------------------------------------

/** Prints the document as it is now (unsaved changes included). */
export async function printDocument(
  tabId: string,
  options: Omit<PrintRequest, 'path'>
): Promise<boolean> {
  const tab = getTab(tabId)
  if (!tab) return false
  await settle(tabId)
  const id = toast.loading(`Sending ${tab.fileName} to ${options.printer}…`)
  try {
    const { path } = await engine.printFile(tab.docId)
    await window.api.print.print({ ...options, path })
    toast.success(`Sent to ${options.printer}`, {
      id,
      description:
        options.copies > 1 ? `${options.copies} copies of ${tab.fileName}` : tab.fileName,
      duration: 4000
    })
    return true
  } catch (error) {
    toast.error('Could not print', { id, description: describe(error) })
    return false
  }
}
