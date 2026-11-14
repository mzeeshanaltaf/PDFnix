import { expect, test } from './harness'

interface Field {
  name: string
  value: unknown
}

test('reorders pages in the organiser and undoes it', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('pages.pdf')
  const { docId } = await pdfnix.open(path)

  await pdfnix.command('document.organise')
  const pages = page.getByRole('listbox', { name: 'Pages' })
  await expect(pages.getByRole('option')).toHaveCount(3)
  await pages.getByRole('option', { name: 'Page 1', exact: true }).click()
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(() => pdfnix.pageText(docId, 0)).toBe('Bravo')
  expect(await pdfnix.pageText(docId, 1)).toBe('Alpha')
  expect(await pdfnix.pageText(docId, 2)).toBe('Charlie')

  await page.keyboard.press('Control+z')
  await expect.poll(() => pdfnix.pageText(docId, 0)).toBe('Alpha')
})

test('fills a form', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('form.pdf')
  const { docId } = await pdfnix.open(path)

  const name = page.getByRole('textbox', { name: 'Full name' })
  await name.click()
  await name.fill('Ada Lovelace')
  await name.press('Tab')
  await page.getByRole('checkbox', { name: 'Agree' }).click()

  await expect
    .poll(async () => {
      const fields = await pdfnix.engine<Field[]>('GET', `/docs/${docId}/forms`)
      return Object.fromEntries(fields.map((field) => [field.name, field.value]))
    })
    .toEqual({ fullName: 'Ada Lovelace', agree: true })
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await pdfnix.state(path)).modified).toBe(false)
})

test('redacts a selected word', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('report.pdf')
  const { docId } = await pdfnix.open(path)

  // Go to page 3 and mark its "aardvark" with R.
  const pageNumber = page.getByLabel('Page number')
  await pageNumber.fill('3')
  await pageNumber.press('Enter')
  await expect(pdfnix.word(2, 'aardvark')).toBeVisible()
  await pdfnix.selectWords(2, 'aardvark')
  await page.keyboard.press('r')

  // Apply the mark from the Redact dialog, through its confirmation.
  await pdfnix.command('document.redact')
  await page.getByRole('button', { name: /Apply 1 redaction/ }).click()
  await page.getByRole('button', { name: 'Apply redactions' }).click()

  await expect.poll(() => pdfnix.pageText(docId, 2)).not.toContain('aardvark')
  expect(await pdfnix.pageText(docId, 2)).toContain('appears on this page.')
  expect(await pdfnix.pageText(docId, 8)).toContain('aardvark')
})
