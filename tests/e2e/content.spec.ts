import { expect, test } from './harness'

interface Blocks {
  images: { imageId: number; bbox: number[] }[]
}

test('adds a text box and places a signature, then saves', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('report.pdf')
  const { docId } = await pdfnix.open(path)

  // Text box: T, click, type, Escape commits it.
  await page.keyboard.press('t')
  const spot = await pdfnix.pointOnPage(0, 612, 300, 420)
  await page.mouse.click(spot.x, spot.y)
  await page.keyboard.type('Hello from the e2e test')
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => (await pdfnix.annotations(docId)).map((a) => `${a.type}:${a.contents}`))
    .toEqual(['freetext:Hello from the e2e test'])

  // A signature in the library (drawn on a canvas), placed with the Sign command.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 100
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.lineWidth = 6
    context.beginPath()
    context.moveTo(10, 70)
    context.bezierCurveTo(60, 0, 120, 100, 180, 30)
    context.bezierCurveTo(220, 0, 260, 90, 290, 40)
    context.stroke()
    const png = canvas.toDataURL('image/png').split(',')[1]
    await window.api.signatures.add({ kind: 'signature', name: 'E2E', png })
  })
  await pdfnix.command('tools.sign')
  await expect(page.getByText('Click on the page to place your signature')).toBeVisible()
  // Within the window at the default zoom (the page is taller than the view).
  const where = await pdfnix.pointOnPage(0, 612, 200, 260)
  await page.mouse.click(where.x, where.y)
  await page.keyboard.press('Enter')
  await expect
    .poll(
      async () =>
        (await pdfnix.engine<Blocks>('GET', `/docs/${docId}/pages/0/blocks`)).images.length
    )
    .toBe(1)
  expect((await pdfnix.state(path)).undoName).toBe('Signature')

  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await pdfnix.state(path)).modified).toBe(false)
})
