/**
 * The pure parts of printing: reading the printer list, checking a print
 * request from the renderer, and turning it into `pdf-to-printer` options.
 */

import { basename, dirname, extname, relative, resolve, isAbsolute } from 'node:path'
import type { PrinterInfo, PrintRequest } from '../shared/api'

/** The temporary folders the engine writes print files into. */
export const PRINT_FOLDER_PREFIX = 'pdfnix-print-'

interface CimPrinter {
  Name?: unknown
  Default?: unknown
  CapabilityDescriptions?: unknown
}

/**
 * The output of `Get-CimInstance Win32_Printer | Select-Object Name, Default,
 * CapabilityDescriptions | ConvertTo-Json` (one object, or an array of them),
 * the default printer first, then by name.
 */
export function parsePrinters(json: string): PrinterInfo[] {
  const text = json.trim()
  if (text === '') return []
  const parsed: unknown = JSON.parse(text)
  const list = (Array.isArray(parsed) ? parsed : [parsed]) as CimPrinter[]
  const printers: PrinterInfo[] = []
  for (const item of list) {
    if (typeof item?.Name !== 'string' || item.Name === '') continue
    const capabilities = Array.isArray(item.CapabilityDescriptions)
      ? item.CapabilityDescriptions.filter((value): value is string => typeof value === 'string')
      : typeof item.CapabilityDescriptions === 'string'
        ? [item.CapabilityDescriptions]
        : []
    printers.push({
      name: item.Name,
      isDefault: item.Default === true,
      duplex: capabilities.some((value) => value.toLowerCase() === 'duplex'),
      color: capabilities.some((value) => value.toLowerCase() === 'color')
    })
  }
  return printers.sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)
  )
}

const SCALES = new Set(['fit', 'noscale', 'shrink'])
const SIDES = new Set(['simplex', 'duplexlong', 'duplexshort'])
const ORIENTATIONS = new Set(['portrait', 'landscape'])

/** Checks a request from the renderer; throws a readable error if it is not valid. */
export function validatePrintRequest(value: unknown): PrintRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid print request.')
  const request = value as Record<string, unknown>
  const { path, printer, pages, copies, orientation, scale, monochrome, side } = request
  if (typeof path !== 'string' || path === '') throw new Error('No file to print.')
  if (typeof printer !== 'string' || printer === '') throw new Error('Choose a printer.')
  if (
    pages !== undefined &&
    (typeof pages !== 'string' || !/^\d+(-\d*)?(,\d+(-\d*)?)*$/.test(pages))
  )
    throw new Error('Invalid page range.')
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 999)
    throw new Error('Copies must be a whole number from 1 to 999.')
  if (orientation !== undefined && !ORIENTATIONS.has(orientation as string))
    throw new Error('Invalid orientation.')
  if (!SCALES.has(scale as string)) throw new Error('Invalid scaling.')
  if (typeof monochrome !== 'boolean') throw new Error('Invalid colour choice.')
  if (side !== undefined && !SIDES.has(side as string)) throw new Error('Invalid duplex choice.')
  return {
    path,
    printer,
    pages: pages as string | undefined,
    copies,
    orientation: orientation as PrintRequest['orientation'],
    scale: scale as PrintRequest['scale'],
    monochrome,
    side: side as PrintRequest['side']
  }
}

/**
 * True if `path` is a PDF directly inside a `pdfnix-print-*` folder in the
 * temporary directory `tempDir`: only such files are printed and deleted.
 */
export function isPrintTempFile(path: string, tempDir: string): boolean {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.pdf') return false
  const folder = dirname(resolve(path))
  if (!basename(folder).startsWith(PRINT_FOLDER_PREFIX)) return false
  const inside = relative(resolve(tempDir), folder)
  return inside === basename(folder)
}

/** Options for `pdf-to-printer`'s `print` (which drives SumatraPDF). */
export interface PrinterOptions {
  printer: string
  pages?: string
  copies: number
  orientation?: 'portrait' | 'landscape'
  scale: 'fit' | 'noscale' | 'shrink'
  monochrome: boolean
  side?: 'simplex' | 'duplexlong' | 'duplexshort'
  silent: true
}

export function toPrinterOptions(request: PrintRequest): PrinterOptions {
  return {
    printer: request.printer,
    ...(request.pages ? { pages: request.pages } : {}),
    copies: request.copies,
    ...(request.orientation ? { orientation: request.orientation } : {}),
    scale: request.scale,
    monochrome: request.monochrome,
    ...(request.side ? { side: request.side } : {}),
    silent: true
  }
}
