import { expect, test } from './harness'

const URL = 'https://example.com/pdfnix-link'

test('links: hover shows a hand, web links ask first, page links jump', async ({ pdfnix }) => {
  const { page, app } = pdfnix
  // Record what would open in the browser instead of opening it.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as Record<string, unknown>)['__pdfnixLinks'] = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
  const opened = (): Promise<string[]> =>
    app.evaluate(() => ((globalThis as Record<string, unknown>)['__pdfnixLinks'] as string[]) ?? [])

  await pdfnix.open(pdfnix.copy('links.pdf'))
  const firstPage = page.locator('.pdf-page[data-page-index="0"]')
  const web = firstPage.getByRole('link', { name: URL })
  await expect(web).toBeVisible()
  // The program link is not offered at all.
  await expect(firstPage.locator('.pdf-link')).toHaveCount(2)

  // Hovering shows the hand cursor.
  await web.hover()
  expect(await web.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer')

  // Clicking asks first; Cancel opens nothing.
  await web.click()
  const dialog = page.locator('[role=dialog][data-state=open]')
  await expect(dialog).toContainText('Open this link?')
  await expect(dialog).toContainText(URL)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  expect(await opened()).toEqual([])

  // Open link hands the address to the browser.
  await web.click()
  await page
    .locator('[role=dialog][data-state=open]')
    .getByRole('button', { name: 'Open link' })
    .click()
  await expect.poll(opened).toEqual([URL])

  // A link to another page of the document goes there, without asking.
  await firstPage.getByRole('link', { name: 'Go to page 3' }).click()
  await expect(page.getByLabel('Page number')).toHaveValue('3')
  await expect(page.locator('[role=dialog][data-state=open]')).toHaveCount(0)
})
