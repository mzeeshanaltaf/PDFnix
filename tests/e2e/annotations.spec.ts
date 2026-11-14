import { expect, test, type Annotation } from './harness'

const summary = (annotations: Annotation[]): string[] =>
  annotations.map((a) => `${a.page}:${a.type}:${a.contents}`).sort()

test('highlight, comment, undo, redo, save and reopen', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('report.pdf')
  const { docId } = await pdfnix.open(path)

  // Highlight a selection with H.
  await pdfnix.selectWords(0, 'quick', 'fox')
  await expect(page.getByLabel('Selected text')).toBeVisible()
  await page.keyboard.press('h')
  await expect.poll(async () => summary(await pdfnix.annotations(docId))).toEqual(['0:highlight:'])

  // A note with a comment: arm the tool, click on the page, type, Ctrl+Enter.
  await page.keyboard.press('n')
  const spot = await pdfnix.pointOnPage(0, 612, 400, 300)
  await page.mouse.click(spot.x, spot.y)
  const comment = page.getByRole('textbox', { name: 'Comment' })
  await expect(comment).toBeFocused()
  await comment.fill('Checked by the e2e test')
  await comment.press('Control+Enter')
  const annotated = ['0:highlight:', '0:note:Checked by the e2e test']
  await expect.poll(async () => summary(await pdfnix.annotations(docId))).toEqual(annotated)

  // Undo takes the last change back; redo restores it.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  await expect.poll(async () => summary(await pdfnix.annotations(docId))).not.toEqual(annotated)
  expect((await pdfnix.state(path)).canRedo).toBe(true)
  await page.keyboard.press('Control+y')
  await expect.poll(async () => summary(await pdfnix.annotations(docId))).toEqual(annotated)

  // Save, close the tab, open the file again: everything is in the file.
  await expect(pdfnix.tab('report.pdf').getByLabel('Unsaved changes')).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await pdfnix.state(path)).modified).toBe(false)
  await expect(pdfnix.tab('report.pdf').getByLabel('Unsaved changes')).toHaveCount(0)
  await page.keyboard.press('Control+w')
  await expect(pdfnix.tab('report.pdf')).toHaveCount(0)

  const reopened = await pdfnix.open(path)
  expect(reopened.docId).not.toBe(docId)
  expect(summary(await pdfnix.annotations(reopened.docId))).toEqual(annotated)
})
