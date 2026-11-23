import { expect, test } from './harness'

const URL = 'https://example.com/pdfnix-qr'

test('QR codes and barcodes: found in the background, shown in toast, dialog, page and panel @smoke', async ({
  pdfnix
}) => {
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

  await pdfnix.open(pdfnix.copy('codes.pdf'))

  // The background scan announces what it found; View opens the results.
  const toast = page.getByText('Found 1 QR code and 1 barcode')
  await expect(toast).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'View' }).click()
  const results = page.getByRole('dialog', { name: 'QR codes and barcodes' })
  await expect(results).toContainText(URL)
  await expect(results).toContainText('INV-4471')
  await expect(results).toContainText('Code 128')
  await results.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(results).toHaveCount(0)

  // The code is outlined on its page; clicking it shows the content.
  const outline = page.locator('.pdf-page[data-page-index="0"] .pdf-code')
  await expect(outline).toHaveCount(1)
  await outline.click()
  const popup = page.locator('[data-slot=popover-content]')
  await expect(popup).toContainText(URL)

  // Opening the address asks first, like a link.
  await popup.getByRole('button', { name: 'Open link…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Open this link?' })
  await expect(confirm).toContainText(URL)
  await confirm.getByRole('button', { name: 'Open link' }).click()
  await expect.poll(opened).toEqual([URL])

  // The panel lists the codes by page; picking one goes to its page.
  await page.getByRole('button', { name: 'QR Codes' }).click()
  const panel = page.getByRole('region', { name: 'QR Codes' })
  await expect(panel).toContainText('2 found')
  await expect(panel).toContainText('Page 2')
  await panel.getByRole('button', { name: 'Code 128' }).click()
  await expect(page.getByLabel('Page number')).toHaveValue('2')

  // The menu command opens the results too.
  await pdfnix.command('tools.codes')
  await expect(page.getByRole('dialog', { name: 'QR codes and barcodes' })).toContainText(
    'INV-4471'
  )
})
