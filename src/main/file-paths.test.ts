import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  addToRecent,
  isPdfPath,
  pdfPathsFromArgv,
  removeFromRecent,
  samePath,
  toRecentFile
} from './file-paths'

const CWD = resolve('/work/docs')

describe('isPdfPath', () => {
  it('accepts the extension in any case', () => {
    expect(isPdfPath('a.pdf')).toBe(true)
    expect(isPdfPath('C:\\Docs\\REPORT.PDF')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isPdfPath('a.pdf.exe')).toBe(false)
    expect(isPdfPath('pdf')).toBe(false)
    expect(isPdfPath('notes.txt')).toBe(false)
  })
})

describe('samePath', () => {
  it('ignores case and redundant segments', () => {
    expect(samePath(resolve(CWD, 'A.pdf'), resolve(CWD, 'sub', '..', 'a.PDF'))).toBe(true)
    expect(samePath(resolve(CWD, 'a.pdf'), resolve(CWD, 'b.pdf'))).toBe(false)
  })
})

describe('pdfPathsFromArgv', () => {
  it('returns nothing when no file is named', () => {
    expect(pdfPathsFromArgv(['pdfnix.exe'], CWD)).toEqual([])
    expect(pdfPathsFromArgv([], CWD)).toEqual([])
  })

  it('never treats the executable as a document', () => {
    expect(pdfPathsFromArgv(['C:\\tools\\reader.pdf'], CWD)).toEqual([])
  })

  it('keeps absolute paths and resolves relative ones against the working folder', () => {
    const absolute = resolve('/elsewhere/report.pdf')
    expect(pdfPathsFromArgv(['pdfnix.exe', absolute, 'local.pdf'], CWD)).toEqual([
      absolute,
      resolve(CWD, 'local.pdf')
    ])
  })

  it('skips flags, the app folder of a development run and other files', () => {
    const argv = [
      'electron.exe',
      '.',
      '--remote-debugging-port=9222',
      '--allow-file-access-from-files',
      'notes.txt',
      '--file=hidden.pdf',
      'real.pdf'
    ]
    expect(pdfPathsFromArgv(argv, CWD)).toEqual([resolve(CWD, 'real.pdf')])
  })

  it('lists a file once even if it is named twice', () => {
    expect(pdfPathsFromArgv(['pdfnix.exe', 'a.pdf', 'A.PDF'], CWD)).toEqual([resolve(CWD, 'a.pdf')])
  })
})

describe('recent files', () => {
  const a = resolve('/docs/a.pdf')
  const b = resolve('/docs/b.pdf')
  const c = resolve('/docs/c.pdf')

  it('puts the newest file first', () => {
    expect(addToRecent([a, b], c)).toEqual([c, a, b])
  })

  it('moves a file that is already listed to the front instead of repeating it', () => {
    expect(addToRecent([a, b, c], c.toUpperCase())).toEqual([resolve(c.toUpperCase()), a, b])
  })

  it('keeps at most the given number of files', () => {
    expect(addToRecent([a, b], c, 2)).toEqual([c, a])
    const many = Array.from({ length: 20 }, (_, index) => resolve(`/docs/${index}.pdf`))
    expect(addToRecent(many, a)).toHaveLength(15)
  })

  it('removes a file regardless of case', () => {
    expect(removeFromRecent([a, b], b.toUpperCase())).toEqual([a])
  })

  it('describes a file by name and folder', () => {
    expect(toRecentFile(a)).toEqual({ path: a, name: 'a.pdf', folder: resolve('/docs') })
  })
})
