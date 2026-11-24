import { expect, test, type Annotation } from './harness'

const summary = (annotations: Annotation[]): string[] =>
  annotations.map((a) => `${a.page}:${a.type}:${a.contents}`).sort()

test('commented text shows a marker; comments and notes can be deleted from their pop-up', async ({
  pdfnix
}) => {
  const { page } = pdfnix
  const { docId } = await pdfnix.open(pdfnix.copy('report.pdf'))
  const comment = page.getByRole('textbox', { name: 'Comment' })

  // Comment from the selection menu: highlight + comment, then a marker on it.
  await pdfnix.selectWords(0, 'quick', 'fox')
  await page
    .getByRole('menu', { name: 'Selected text' })
    .getByRole('menuitem', { name: 'Comment', exact: true })
    .click()
  await expect(comment).toBeFocused()
  await comment.fill('Why a fox?')
  await comment.press('Control+Enter')
  const marker = page.getByRole('button', { name: 'Comment: Why a fox?' })
  await expect(marker).toBeVisible()

  // The marker opens the comment; deleting it removes the highlight as well.
  await marker.click()
  await expect(comment).toHaveValue('Why a fox?')
  await page.getByRole('button', { name: 'Delete comment and mark' }).click()
  await expect.poll(async () => summary(await pdfnix.annotations(docId))).toEqual([])
  await expect(marker).toHaveCount(0)

  // A note: added with N, then opened again by clicking it and deleted.
  await page.keyboard.press('n')
  const spot = await pdfnix.pointOnPage(0, 612, 400, 300)
  await page.mouse.click(spot.x, spot.y)
  await comment.fill('Delete me')
  await comment.press('Control+Enter')
  await expect
    .poll(async () => summary(await pdfnix.annotations(docId)))
    .toEqual(['0:note:Delete me'])
  await page.keyboard.press('v')
  const note = page.locator('.pdf-annotation-hit.note')
  // Once the page's annotations are loaded again with the saved text.
  await expect(note).toHaveAttribute('title', 'Delete me')
  await note.click()
  await expect(comment).toHaveValue('Delete me')
  await page.getByRole('button', { name: 'Delete note' }).click()
  await expect.poll(async () => summary(await pdfnix.annotations(docId))).toEqual([])
  await expect(page.locator('.pdf-annotation-hit.note')).toHaveCount(0)
})

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
