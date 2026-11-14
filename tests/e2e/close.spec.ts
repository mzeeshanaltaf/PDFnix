import { readFileSync } from 'fs'
import { expect, test, type Pdfnix } from './harness'

const SAVE = 0
const DONT_SAVE = 1
const CANCEL = 2

/** Opens a copy of report.pdf and rotates its first page (an unsaved change). */
async function changedDocument(pdfnix: Pdfnix): Promise<string> {
  const path = pdfnix.copy('report.pdf')
  await pdfnix.open(path)
  await pdfnix.page.getByRole('button', { name: 'Rotate page right' }).click()
  await expect.poll(async () => (await pdfnix.state(path)).modified).toBe(true)
  return path
}

test('closing with unsaved changes: Cancel keeps the window @smoke', async ({ pdfnix }) => {
  const path = await changedDocument(pdfnix)
  await pdfnix.answerMessageBoxes(CANCEL)
  await pdfnix.closeWindow()
  await expect
    .poll(() => pdfnix.askedMessages())
    .toEqual(['Do you want to save the changes to report.pdf?'])
  // Still running, still modified, still the tab.
  await expect(pdfnix.tab('report.pdf')).toBeVisible()
  expect((await pdfnix.state(path)).modified).toBe(true)
})

test("closing with unsaved changes: Don't Save quits and leaves the file", async ({ pdfnix }) => {
  const path = await changedDocument(pdfnix)
  const before = readFileSync(path)
  await pdfnix.answerMessageBoxes(DONT_SAVE)
  await pdfnix.closeWindow()
  await pdfnix.exited()
  expect(readFileSync(path).equals(before)).toBe(true)
})

test('closing with unsaved changes: Save writes the file and quits', async ({ pdfnix }) => {
  const path = await changedDocument(pdfnix)
  const before = readFileSync(path)
  await pdfnix.answerMessageBoxes(SAVE)
  await pdfnix.closeWindow()
  await pdfnix.exited()
  const after = readFileSync(path)
  expect(after.equals(before)).toBe(false)
  expect(after.subarray(0, 5).toString('latin1')).toBe('%PDF-')
})
