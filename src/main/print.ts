/**
 * Printing (main process). The engine writes the document as it is now to a
 * temporary file; this module sends it to a printer with `pdf-to-printer`,
 * which drives the SumatraPDF it bundles (silent printing, no window), and then
 * deletes the file. The printer list comes from Windows (CIM `Win32_Printer`),
 * which also says which printers can print on both sides.
 */

import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { print as printPdf } from 'pdf-to-printer'
import type { PrinterInfo } from '../shared/api'
import {
  isPrintTempFile,
  parsePrinters,
  toPrinterOptions,
  validatePrintRequest
} from './print-options'

const run = promisify(execFile)

const LIST_PRINTERS =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
  'Get-CimInstance Win32_Printer | Select-Object Name, Default, CapabilityDescriptions | ' +
  'ConvertTo-Json -Compress'

export async function listPrinters(): Promise<PrinterInfo[]> {
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', LIST_PRINTERS],
    { windowsHide: true, timeout: 20000 }
  )
  return parsePrinters(stdout)
}

/** Prints the engine's temporary file, then deletes its folder. */
export async function printFile(value: unknown): Promise<void> {
  const request = validatePrintRequest(value)
  if (!isPrintTempFile(request.path, tmpdir())) {
    throw new Error('Only files prepared for printing can be printed.')
  }
  try {
    await printPdf(request.path, toPrinterOptions(request))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`The document could not be sent to ${request.printer}. ${message}`.trim(), {
      cause: error
    })
  } finally {
    await rm(dirname(request.path), { recursive: true, force: true }).catch(() => undefined)
  }
}
