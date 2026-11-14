import { existsSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../src/shared/api'
import { FIXTURES } from './paths'
import { expect, test, type Pdfnix } from './harness'

interface Health {
  status: string
  pid: number
}

/** Asks the app to open a file and waits until it shows the file or says why not. */
async function tryOpen(pdfnix: Pdfnix, name: string): Promise<'opened' | 'refused'> {
  const path = join(FIXTURES, 'corpus', name)
  await pdfnix.app.evaluate(
    ({ BrowserWindow }, { channel, path }) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, [path])
    },
    { channel: IPC.filesOpenRequest, path }
  )
  const tab = pdfnix.tab(name)
  const refusal = pdfnix.page.locator('[data-sonner-toast]', { hasText: `Could not open ${name}` })
  await expect(tab.or(refusal).first()).toBeVisible()
  return (await tab.count()) > 0 ? 'opened' : 'refused'
}

test('unusual and malformed PDFs open or are refused clearly @smoke', async ({ pdfnix }) => {
  const { page } = pdfnix
  for (const name of [
    'damaged-xref.pdf',
    'page-sizes.pdf',
    'right-to-left.pdf',
    'heavy-vectors.pdf',
    'portfolio.pdf'
  ]) {
    expect(await tryOpen(pdfnix, name), name).toBe('opened')
    await expect(page.locator('.pdf-page img').first(), name).toBeVisible()
  }
  for (const name of ['not-a-pdf.pdf', 'empty.pdf']) {
    expect(await tryOpen(pdfnix, name), name).toBe('refused')
  }
  // A truncated file is either repaired or refused; both are fine.
  await tryOpen(pdfnix, 'truncated.pdf')

  // The huge page renders within the image budget; the engine is still healthy.
  const sizes = pdfnix.tab('page-sizes.pdf')
  await sizes.click()
  await page.getByLabel('Page number').fill('2')
  await page.getByLabel('Page number').press('Enter')
  await expect(page.locator('.pdf-page[data-page-index="1"] img')).toBeVisible()
  const health = await pdfnix.engine<Health>('GET', '/health')
  expect(health.status).toBe('ok')
  expect((await pdfnix.documents()).length).toBeGreaterThanOrEqual(5)
})

test('pages are rendered again when the display scaling changes', async ({ pdfnix }) => {
  const { page } = pdfnix
  await pdfnix.open(pdfnix.copy('report.pdf'))
  /** Image pixels per device pixel of the first page (1 = sharp). */
  const sharpness = (): Promise<number> =>
    page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('.pdf-page[data-page-index="0"] img')
      if (!img || img.naturalWidth === 0) return 0
      return img.naturalWidth / (img.getBoundingClientRect().width * devicePixelRatio)
    })
  await expect.poll(sharpness).toBeCloseTo(1, 1)

  // As when the window moves to a display with other scaling.
  const cdp = await page.context().newCDPSession(page)
  for (const factor of [2, 1.5]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 0,
      height: 0,
      deviceScaleFactor: factor,
      mobile: false
    })
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(factor)
    // Crisp: at least one image pixel per device pixel (a sharper image that
    // is already there may be kept when the scaling goes down).
    await expect.poll(sharpness).toBeGreaterThanOrEqual(0.97)
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride')
})

test('an engine crash during a job is reported and unsaved work comes back', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('long-scan.pdf')
  const { docId } = await pdfnix.open(path)
  // An unsaved change, written to a recovery copy within ~15 s.
  await pdfnix.engine('PUT', '/recovery/settings', { delaySeconds: 10 })
  await page.getByRole('button', { name: 'Rotate page right' }).click()
  await expect.poll(async () => (await pdfnix.state(path)).modified).toBe(true)
  const copy = join(pdfnix.profile, 'recovery', `${docId}.pdf`)
  await expect.poll(() => existsSync(copy), { timeout: 30_000 }).toBe(true)

  // Start OCR of all 30 pages and stop the engine while it runs.
  await pdfnix.command('tools.ocr')
  await page.getByRole('button', { name: 'Recognise Text', exact: true }).click()
  const progress = page.getByRole('dialog', { name: 'Recognising text' })
  await expect(progress).toBeVisible()
  const { pid } = await pdfnix.engine<Health>('GET', '/health')
  process.kill(pid)

  // The app says so, starts a new engine and reopens the tab from the copy.
  await expect(
    page.locator('[data-sonner-toast]', { hasText: 'Could not recognise the text' })
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.locator('[data-sonner-toast]', { hasText: 'The PDF engine was restarted' })
  ).toBeVisible({ timeout: 30_000 })
  const health = await pdfnix.engine<Health>('GET', '/health')
  expect(health.pid).not.toBe(pid)
  const reopened = await pdfnix.state(path)
  expect(reopened.modified).toBe(true)
  // The first page is still turned (portrait page shown landscape).
  const box = await page.locator('.pdf-page[data-page-index="0"]').boundingBox()
  expect(box && box.width > box.height).toBe(true)
  await expect(progress).toBeHidden()
})
