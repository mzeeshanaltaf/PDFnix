import { expect, test } from './harness'

test('Settings change how documents open and are kept', async ({ pdfnix }) => {
  const { page } = pdfnix
  await page.keyboard.press('Control+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Zoom').selectOption('fit-page')
  await dialog.getByLabel('Page layout').selectOption('two-page')
  await dialog.getByRole('radio', { name: 'Dark' }).check()
  await dialog.getByLabel('Minutes before a recovery copy').fill('5')
  // The bundled language is offered and chosen.
  await expect(dialog.getByRole('button', { name: 'English' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  await expect
    .poll(() => page.evaluate(() => window.api.settings.get()))
    .toMatchObject({
      defaultZoom: 'fit-page',
      defaultLayout: 'two-page',
      recoveryMinutes: 5,
      ocrLanguages: ['eng']
    })
  expect(await page.evaluate(() => window.api.theme.get())).toBe('dark')
  // Playwright pins the page's own prefers-color-scheme, so look at what main set.
  expect(
    await pdfnix.app.evaluate(({ nativeTheme }) => [
      nativeTheme.themeSource,
      nativeTheme.shouldUseDarkColors
    ])
  ).toEqual(['dark', true])

  // A document opened now fits its page into the window, two pages side by side.
  await pdfnix.open(pdfnix.copy('report.pdf'))
  const viewport =
    page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  const first = await page.locator('.pdf-page[data-page-index="0"]').boundingBox()
  const second = await page.locator('.pdf-page[data-page-index="1"]').boundingBox()
  if (!first || !second) throw new Error('pages not shown')
  expect(first.height).toBeLessThan(viewport.height)
  expect(Math.abs(first.y - second.y)).toBeLessThan(2)
  expect(second.x).toBeGreaterThan(first.x + first.width - 1)
})
