import { expect, test } from './harness'

test('opens a PDF, scrolls, zooms, rotates and searches @smoke', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('report.pdf')
  const doc = await pdfnix.open(path)
  expect(doc.pageCount).toBe(12)
  await expect(page.getByLabel('Page count')).toHaveText('/ 12')

  // Scroll down with the wheel: the page number follows.
  const pageNumber = page.getByLabel('Page number')
  await expect(pageNumber).toHaveValue('1')
  const first = await page.locator('.pdf-page[data-page-index="0"]').boundingBox()
  if (!first) throw new Error('first page not shown')
  await page.mouse.move(first.x + first.width / 2, first.y + 200)
  for (let step = 0; step < 12; step++) await page.mouse.wheel(0, 500)
  await expect.poll(async () => Number(await pageNumber.inputValue())).toBeGreaterThan(2)

  // Zoom in with the button and with the keyboard; pages get wider.
  const zoom = page.getByLabel('Zoom level')
  const before = await zoom.inputValue()
  const width = async (): Promise<number> =>
    (await page.locator('.pdf-page').first().boundingBox())?.width ?? 0
  const widthBefore = await width()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).not.toHaveValue(before)
  await page.keyboard.press('Control+Equal')
  await expect.poll(width).toBeGreaterThan(widthBefore * 1.2)

  // Rotate the current page: an undoable change in the engine.
  await page.getByRole('button', { name: 'Rotate page right' }).click()
  await expect.poll(async () => (await pdfnix.state(path)).modified).toBe(true)
  expect((await pdfnix.state(path)).canUndo).toBe(true)

  // Find: both pages with the word are listed.
  await page.keyboard.press('Control+f')
  const find = page.getByLabel('Find in document')
  await find.fill('aardvark')
  await find.press('Enter')
  const results = page.getByLabel('Search results')
  await expect(results).toContainText('Page 3')
  await expect(results).toContainText('Page 9')
})
