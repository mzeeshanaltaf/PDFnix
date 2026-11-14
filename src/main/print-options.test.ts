import { describe, expect, it } from 'vitest'
import {
  isPrintTempFile,
  parsePrinters,
  toPrinterOptions,
  validatePrintRequest
} from './print-options'

describe('parsePrinters', () => {
  it('reads an array, puts the default first and reads duplex and colour', () => {
    const json = JSON.stringify([
      { Name: 'Send To OneNote 2016', Default: false, CapabilityDescriptions: ['Copies', 'Color'] },
      { Name: 'Office Laser', Default: false, CapabilityDescriptions: ['Copies', 'Duplex'] },
      { Name: 'Microsoft Print to PDF', Default: true, CapabilityDescriptions: ['Copies', 'Color'] }
    ])
    expect(parsePrinters(json)).toEqual([
      { name: 'Microsoft Print to PDF', isDefault: true, duplex: false, color: true },
      { name: 'Office Laser', isDefault: false, duplex: true, color: false },
      { name: 'Send To OneNote 2016', isDefault: false, duplex: false, color: true }
    ])
  })

  it('reads a single printer (PowerShell does not wrap one object in an array)', () => {
    expect(parsePrinters('{"Name":"Only","Default":true,"CapabilityDescriptions":null}')).toEqual([
      { name: 'Only', isDefault: true, duplex: false, color: false }
    ])
  })

  it('returns nothing for no output and skips entries without a name', () => {
    expect(parsePrinters('  ')).toEqual([])
    expect(parsePrinters('[{"Default":true}]')).toEqual([])
  })
})

const valid = {
  path: 'C:\\Temp\\pdfnix-print-abc\\doc.pdf',
  printer: 'Office Laser',
  copies: 2,
  scale: 'fit',
  monochrome: false
}

describe('validatePrintRequest', () => {
  it('accepts a complete request', () => {
    expect(validatePrintRequest({ ...valid, pages: '1-3,5,9-', side: 'duplexlong' })).toEqual({
      ...valid,
      pages: '1-3,5,9-',
      side: 'duplexlong',
      orientation: undefined
    })
  })

  it.each([
    [{ ...valid, path: '' }, 'No file'],
    [{ ...valid, printer: '' }, 'printer'],
    [{ ...valid, copies: 0 }, 'Copies'],
    [{ ...valid, copies: 1.5 }, 'Copies'],
    [{ ...valid, scale: 'huge' }, 'scaling'],
    [{ ...valid, pages: '1-3; rm -rf' }, 'page range'],
    [{ ...valid, side: 'both' }, 'duplex'],
    [{ ...valid, orientation: 'sideways' }, 'orientation']
  ])('refuses %o', (request, message) => {
    expect(() => validatePrintRequest(request)).toThrow(message)
  })
})

describe('isPrintTempFile', () => {
  const temp = 'C:\\Users\\me\\AppData\\Local\\Temp'
  it('accepts a PDF in a pdfnix-print folder directly inside the temp folder', () => {
    expect(isPrintTempFile(`${temp}\\pdfnix-print-x1y2\\Report.pdf`, temp)).toBe(true)
  })
  it.each([
    `${temp}\\other\\Report.pdf`,
    `${temp}\\pdfnix-print-x1y2\\Report.docx`,
    `${temp}\\deeper\\pdfnix-print-x1y2\\Report.pdf`,
    'C:\\Users\\me\\Documents\\pdfnix-print-x\\Report.pdf',
    'pdfnix-print-x\\Report.pdf'
  ])('refuses %s', (path) => {
    expect(isPrintTempFile(path, temp)).toBe(false)
  })
})

describe('toPrinterOptions', () => {
  it('passes only what was chosen and always prints silently', () => {
    expect(toPrinterOptions({ ...valid, scale: 'noscale', monochrome: true })).toEqual({
      printer: 'Office Laser',
      copies: 2,
      scale: 'noscale',
      monochrome: true,
      silent: true
    })
  })
})
