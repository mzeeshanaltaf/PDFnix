import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { expect, test } from './harness'

interface SearchResult {
  hits: { page: number }[]
}

test('compresses the document as one undoable step', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('scan.pdf')
  await pdfnix.open(path)

  await pdfnix.command('tools.compress')
  await page.getByRole('radio', { name: /Strong/ }).check()
  await page.getByRole('button', { name: 'Compress', exact: true }).click()
  await expect(page.getByText('Result')).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => (await pdfnix.state(path)).undoName).toBe('Compress')
  expect((await pdfnix.state(path)).modified).toBe(true)
})

test('protects the document with a password on save', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('report.pdf')
  await pdfnix.open(path)
  expect(readFileSync(path, 'latin1')).not.toContain('/Encrypt')

  await pdfnix.command('tools.protect')
  await page.locator('#protect-open').fill('s3cret-Pass')
  await page.getByLabel('Password to open the file, again').fill('s3cret-Pass')
  await page.getByRole('button', { name: 'Protect', exact: true }).click()
  await expect.poll(async () => (await pdfnix.state(path)).modified).toBe(true)

  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await pdfnix.state(path)).modified).toBe(false)
  expect(readFileSync(path, 'latin1')).toContain('/Encrypt')
})

test('recognises text in a scan (OCR) @smoke', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('scan.pdf')
  const { docId } = await pdfnix.open(path)
  const search = (): Promise<number> =>
    pdfnix
      .engine<SearchResult>('POST', `/docs/${docId}/search`, { query: 'Rosalind' })
      .then((result) => result.hits.length)
  expect(await search()).toBe(0)

  await pdfnix.command('tools.ocr')
  await page.getByRole('button', { name: 'Recognise Text', exact: true }).click()
  await expect
    .poll(async () => (await pdfnix.state(path)).undoName, { timeout: 60_000 })
    .toBe('Recognise Text')
  expect(await search()).toBe(1)
})

test('converts the PDF to a Word document @smoke', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('report.pdf')
  await pdfnix.open(path)
  const target = join(pdfnix.work, 'report.docx')
  await pdfnix.answerSaveDialogs(target)

  await pdfnix.command('convert.toWord')
  await page.getByRole('button', { name: 'Convert…' }).click()
  await expect.poll(() => existsSync(target), { timeout: 90_000 }).toBe(true)
  await expect.poll(() => statSync(target).size).toBeGreaterThan(5_000)
  // A .docx is a zip archive.
  expect(readFileSync(target).subarray(0, 2).toString('latin1')).toBe('PK')
})
