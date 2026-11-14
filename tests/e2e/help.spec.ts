import { existsSync } from 'fs'
import { expect, test } from './harness'

test('About shows versions and opens the licence notices @smoke', async ({ pdfnix }) => {
  const { page, app } = pdfnix
  await app.evaluate(({ shell }) => {
    shell.openPath = async (path: string) => {
      ;(globalThis as Record<string, unknown>)['__pdfnixOpened'] = path
      return ''
    }
  })

  await pdfnix.command('help.about')
  const about = page.getByRole('dialog', { name: 'PDFnix' })
  await expect(about).toBeVisible()
  const versions = about.getByRole('region', { name: 'Versions' })
  await expect(versions).toContainText('PyMuPDF')
  await expect(versions).toContainText('2.1')
  await expect(about.getByRole('region', { name: 'Licences' })).toContainText('GNU AGPL v3')

  await about.getByRole('button', { name: 'View all licence notices' }).click()
  const opened = (): Promise<string> =>
    app.evaluate(() => ((globalThis as Record<string, unknown>)['__pdfnixOpened'] as string) ?? '')
  await expect.poll(opened).toMatch(/THIRD-PARTY-NOTICES\.txt$/)
  expect(existsSync(await opened())).toBe(true)
  await about.getByRole('button', { name: 'Close' }).first().click()
  await expect(about).toBeHidden()
})

test('Ctrl+/ shows the keyboard shortcuts', async ({ pdfnix }) => {
  const { page } = pdfnix
  await page.keyboard.press('Control+/')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Tools' })).toContainText('Highlight')
  await expect(dialog.getByRole('region', { name: 'Pages and documents' })).toContainText(
    'Organise pages'
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
