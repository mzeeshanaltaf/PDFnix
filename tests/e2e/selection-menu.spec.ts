import type { Locator } from '@playwright/test'
import { expect, test, type Pdfnix } from './harness'

const ITEMS = [
  'Comment',
  'Highlight',
  'Underline',
  'Strikeout',
  'Redact',
  'Colour',
  'Copy text',
  'Edit text'
]
const AI_ITEMS = ['Simplify', 'Define', 'Ask AI Assistant']

function menu(pdfnix: Pdfnix): Locator {
  return pdfnix.page.getByRole('menu', { name: 'Selected text' })
}

function item(pdfnix: Pdfnix, name: string): Locator {
  return menu(pdfnix).getByRole('menuitem', { name, exact: true })
}

async function selectedText(pdfnix: Pdfnix): Promise<string> {
  return pdfnix.page.evaluate(() => document.getSelection()?.toString() ?? '')
}

test('the menu over selected text marks it up and copies it', async ({ pdfnix }) => {
  const path = pdfnix.copy('report.pdf')
  const { docId } = await pdfnix.open(path)

  // Every item is there, then the AI Assistant section (phase 10) and nothing else.
  await pdfnix.selectWords(0, 'quick', 'fox')
  await expect(menu(pdfnix)).toBeVisible()
  for (const name of [...ITEMS, ...AI_ITEMS]) await expect(item(pdfnix, name)).toBeVisible()
  await expect(menu(pdfnix).getByRole('menuitem')).toHaveCount(ITEMS.length + AI_ITEMS.length)
  await expect(menu(pdfnix).getByRole('separator')).toHaveCount(2)
  const ai = menu(pdfnix).getByRole('group', { name: 'AI Assistant' })
  await expect(ai.getByRole('menuitem')).toHaveText(AI_ITEMS)
  await expect(ai).toContainText('Runs on this computer with LM Studio')

  // Highlight from the menu.
  await item(pdfnix, 'Highlight').click()
  await expect
    .poll(async () => (await pdfnix.annotations(docId)).map((a) => `${a.page}:${a.type}`))
    .toEqual(['0:highlight'])
  await expect(menu(pdfnix)).toHaveCount(0)

  // Copy text puts the selection on the clipboard and keeps it selected.
  await pdfnix.app.evaluate(({ clipboard }) => clipboard.writeText('nothing yet'))
  await pdfnix.selectWords(0, 'brown', 'jumps')
  await item(pdfnix, 'Copy text').click()
  await expect
    .poll(() => pdfnix.app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('brown fox jumps')
  await expect(menu(pdfnix)).toHaveCount(0)
  expect(await selectedText(pdfnix)).toContain('fox')

  // Ctrl+C still copies while the menu is open. (Starting the drag on the
  // kept selection would drag the text, so it starts further on.)
  await pdfnix.selectWords(0, 'the', 'dog')
  await expect(menu(pdfnix)).toBeVisible()
  await pdfnix.page.keyboard.press('Control+c')
  await expect
    .poll(() => pdfnix.app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('the lazy dog')
})

test('Edit text opens the editor on the block that holds the selection', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('report.pdf')
  await pdfnix.open(path)

  await pdfnix.selectWords(0, 'lazy', 'dog')
  const word = await pdfnix.word(0, 'lazy').boundingBox()
  await item(pdfnix, 'Edit text').click()

  const editor = page.getByRole('textbox', { name: 'Edit text' })
  await expect(editor).toBeVisible()
  await expect(editor).toHaveValue(/The quick brown fox jumps over the lazy dog/)
  const box = await editor.boundingBox()
  if (!word || !box) throw new Error('no boxes')
  const centre = { x: word.x + word.width / 2, y: word.y + word.height / 2 }
  expect(centre.x).toBeGreaterThan(box.x)
  expect(centre.x).toBeLessThan(box.x + box.width)
  expect(centre.y).toBeGreaterThan(box.y)
  expect(centre.y).toBeLessThan(box.y + box.height)
  expect(await selectedText(pdfnix)).toBe('')

  // Nothing typed: Escape closes the editor without changing the document.
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  expect((await pdfnix.state(path)).canUndo).toBe(false)
})

test('colours, keys, armed tools, two pages and turned pages', async ({ pdfnix }) => {
  const { page } = pdfnix
  const path = pdfnix.copy('report.pdf')
  const { docId } = await pdfnix.open(path)
  const marks = async (): Promise<string[]> =>
    (
      await pdfnix.engine<{ page: number; type: string; color: string }[]>(
        'GET',
        `/docs/${docId}/annotations`
      )
    ).map((a) => `${a.page}:${a.type}:${a.color}`)

  // A colour picked in the menu applies to the next mark made from it.
  await pdfnix.selectWords(0, 'quick')
  await item(pdfnix, 'Colour').click()
  await menu(pdfnix).getByRole('menuitemradio', { name: 'Colour: Green' }).click()
  await expect(menu(pdfnix).getByRole('menuitemradio', { name: 'Colour: Green' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await item(pdfnix, 'Underline').click()
  await expect.poll(marks).toEqual(['0:underline:#aed581'])

  // Keys keep working while the menu is open (focus stays on the page).
  await pdfnix.selectWords(0, 'lazy', 'dog')
  await expect(menu(pdfnix)).toBeVisible()
  await page.keyboard.press('h')
  await expect.poll(marks).toContain('0:highlight:#ffd54f')
  await expect(menu(pdfnix)).toHaveCount(0)

  // With a markup tool armed, releasing the mouse marks at once; no menu.
  await page.keyboard.press('k')
  await pdfnix.selectWords(0, 'brown')
  await expect.poll(async () => (await marks()).length).toBe(3)
  expect(await marks()).toContain('0:strikeout:#e53935')
  await expect(menu(pdfnix)).toHaveCount(0)
  await page.keyboard.press('v')

  // A selection over two pages: one highlight per page. Zoomed out so both
  // pages' text is on screen.
  await page.keyboard.press('Control+2')
  // The text layers are rebuilt after the zoom and the earlier marks, which
  // ends a selection made too early; select again until the menu stays.
  await expect(async () => {
    const selected = await page.evaluate(() => {
      const spans = (index: number): Element[] => [
        ...document.querySelectorAll(`.pdf-text-layer[data-page-index="${index}"] span`)
      ]
      const first = spans(0).find((span) => span.textContent?.includes('second'))
      const last = spans(1).find((span) => span.textContent?.includes('body'))
      if (!first?.firstChild || !last?.firstChild) return false
      const range = document.createRange()
      range.setStart(first.firstChild, 0)
      range.setEnd(last.firstChild, last.firstChild.textContent?.length ?? 0)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
      document.dispatchEvent(new PointerEvent('pointerup', { button: 0 }))
      return true
    })
    expect(selected, 'pages 1 and 2 are shown').toBe(true)
    await page.waitForTimeout(300)
    await expect(menu(pdfnix)).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
  await item(pdfnix, 'Highlight').click()
  await expect
    .poll(async () => (await marks()).filter((m) => m.includes('highlight')))
    .toEqual(['0:highlight:#ffd54f', '0:highlight:#ffd54f', '1:highlight:#ffd54f'])

  // On a page turned 90°, Edit text still finds the selected block.
  await page.keyboard.press('Control+r')
  await expect.poll(async () => (await pdfnix.state(path)).undoName).toBe('Rotate')
  const turned = page.locator('.pdf-page[data-page-index="0"]')
  await expect
    .poll(async () => {
      const box = await turned.boundingBox()
      return box ? box.width > box.height : false
    })
    .toBe(true)
  await expect(pdfnix.word(0, 'Chapter')).toBeVisible()
  // The words run downwards now, so select the word's text directly.
  await pdfnix.word(0, 'Chapter').evaluate((span) => {
    const range = document.createRange()
    range.selectNodeContents(span)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
    document.dispatchEvent(new PointerEvent('pointerup', { button: 0 }))
  })
  await item(pdfnix, 'Edit text').click()
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveValue(/Chapter 1/)
})

test('right-click opens the menu on selected text only; Escape closes it', async ({ pdfnix }) => {
  const { page } = pdfnix
  await pdfnix.open(pdfnix.copy('report.pdf'))

  // Escape closes the menu and keeps the selection.
  await pdfnix.selectWords(0, 'quick')
  await expect(menu(pdfnix)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu(pdfnix)).toHaveCount(0)
  expect(await selectedText(pdfnix)).toContain('quick')

  // Right-click on the selection: the menu opens at the pointer.
  const word = await pdfnix.word(0, 'quick').boundingBox()
  if (!word) throw new Error('no word')
  const at = { x: Math.round(word.x + word.width / 2), y: Math.round(word.y + word.height / 2) }
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu(pdfnix)).toBeVisible()
  const box = await menu(pdfnix).boundingBox()
  expect(Math.abs((box?.x ?? 0) - at.x)).toBeLessThanOrEqual(1)
  expect(Math.abs((box?.y ?? 0) - at.y)).toBeLessThanOrEqual(1)
  expect(await selectedText(pdfnix)).toContain('quick')

  // Clicking empty page space ends the selection and closes the menu;
  // right-click then opens nothing.
  const empty = await pdfnix.pointOnPage(0, 612, 300, 600)
  await page.mouse.click(empty.x, empty.y)
  await expect(menu(pdfnix)).toHaveCount(0)
  expect(await selectedText(pdfnix)).toBe('')
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.waitForTimeout(200)
  await expect(menu(pdfnix)).toHaveCount(0)
})
