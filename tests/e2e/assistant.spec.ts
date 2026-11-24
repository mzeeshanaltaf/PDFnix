import type { Locator } from '@playwright/test'
import { startFakeLmStudio, type FakeLmStudio } from './fakeLmStudio'
import { expect, test, type Pdfnix } from './harness'

let lmStudio: FakeLmStudio

test.beforeEach(async () => {
  lmStudio = await startFakeLmStudio()
})

test.afterEach(async () => {
  await lmStudio.close()
})

/** Points the app at the fake LM Studio and opens the 12-page report. */
async function setUp(pdfnix: Pdfnix, url = lmStudio.url): Promise<void> {
  await pdfnix.page.evaluate((aiServerUrl) => window.api.settings.set({ aiServerUrl }), url)
  await pdfnix.open(pdfnix.copy('report.pdf'))
}

function panel(pdfnix: Pdfnix): Locator {
  return pdfnix.page.getByRole('region', { name: 'AI Assistant' })
}

function menuItem(pdfnix: Pdfnix, name: string): Locator {
  return pdfnix.page
    .getByRole('menu', { name: 'Selected text' })
    .getByRole('menuitem', { name, exact: true })
}

function input(pdfnix: Pdfnix): Locator {
  return panel(pdfnix).getByRole('textbox', { name: 'Ask the AI assistant' })
}

/** Waits until no answer is still arriving. */
async function finished(pdfnix: Pdfnix): Promise<void> {
  await expect(panel(pdfnix).locator('[data-kind="assistant"][data-streaming="true"]')).toHaveCount(
    0
  )
}

/** The answers shown so far, as text. */
function answers(pdfnix: Pdfnix): Locator {
  return panel(pdfnix).getByTestId('assistant-answer')
}

test('Simplify and Define send the selection with the page as context @smoke', async ({
  pdfnix
}) => {
  await setUp(pdfnix)
  await pdfnix.selectWords(0, 'quick', 'fox')
  await menuItem(pdfnix, 'Simplify').click()

  // The panel opens, shows LM Studio's progress, then the streamed answer.
  await expect(panel(pdfnix)).toBeVisible()
  await expect(panel(pdfnix).getByTestId('assistant-progress')).toBeVisible()
  await expect(answers(pdfnix)).toHaveText('Here is a simpler version.')
  await expect(answers(pdfnix).locator('strong')).toHaveText('simpler')
  await expect(panel(pdfnix).getByRole('listitem').first()).toContainText('Simplify')

  const [simplify] = lmStudio.chats()
  expect(simplify.input).toBe('Simplify quick brown fox')
  expect(simplify.model).toBe('google/gemma-4-26b-a4b')
  expect(simplify.reasoning).toBe('off')
  expect(simplify.previous_response_id).toBeUndefined()
  expect(simplify.system_prompt).toContain('The quick brown fox jumps over the lazy dog')
  expect(simplify.system_prompt).toContain('--- Page 1 ---')
  expect(simplify.system_prompt).not.toContain('chapter 2')

  // A new chat, then Define: the same, with its own exact text.
  await finished(pdfnix)
  await panel(pdfnix).getByRole('button', { name: 'Clear chat' }).click()
  await expect(answers(pdfnix)).toHaveCount(0)
  await pdfnix.selectWords(0, 'lazy', 'dog')
  await menuItem(pdfnix, 'Define').click()
  await expect(answers(pdfnix)).toHaveText('Here is a simpler version.')
  const define = lmStudio.chats()[1]
  expect(define.input).toBe('Define lazy dog')
  expect(define.previous_response_id).toBeUndefined()
  expect(define.system_prompt).toContain('The quick brown fox jumps over the lazy dog')
})

test('Ask AI Assistant quotes the selection, and a follow-up continues the conversation', async ({
  pdfnix
}) => {
  const { page } = pdfnix
  await setUp(pdfnix)
  await pdfnix.selectWords(0, 'quick', 'fox')
  await menuItem(pdfnix, 'Ask AI Assistant').click()

  await expect(input(pdfnix)).toBeFocused()
  await expect(panel(pdfnix).getByTestId('assistant-quote')).toHaveText('quick brown fox')
  // Letters typed into the box stay there (H would otherwise highlight).
  await page.keyboard.type('What animal is this?')
  await expect(input(pdfnix)).toHaveValue('What animal is this?')
  await page.keyboard.press('Enter')
  await expect(answers(pdfnix)).toHaveText('Here is a simpler version.')
  await expect(input(pdfnix)).toHaveValue('')
  await expect(panel(pdfnix).getByTestId('assistant-quote')).toHaveCount(0)

  const [first] = lmStudio.chats()
  expect(first.input).toBe('What animal is this?\n\nSelected text:\n"""\nquick brown fox\n"""')
  expect(first.system_prompt).toContain('The quick brown fox')

  // A question asked before the answer has ended would stop it; wait for the end.
  await finished(pdfnix)
  lmStudio.answer = ['It', ' is', ' brown.']
  await input(pdfnix).fill('And its colour?')
  await page.keyboard.press('Enter')
  await expect(answers(pdfnix).nth(1)).toHaveText('It is brown.')
  const second = lmStudio.chats()[1]
  expect(second.input).toBe('And its colour?')
  expect(second.previous_response_id).toBe('resp_fake0001')
  expect(second.system_prompt).toBeUndefined()
  expect(second.context_length).toBe(first.context_length)
  await expect(panel(pdfnix).getByRole('separator')).toHaveCount(0)
})

test('an answer cites its pages: chips go there and highlight the quote; stats and context show', async ({
  pdfnix
}) => {
  const { page } = pdfnix
  lmStudio.answer = ['A fox jumps ', '[p. 1: "quick brown fox jumps"]', '; more on ', '[p. 12].']
  await setUp(pdfnix)
  await page.keyboard.press('Control+Shift+A')
  await input(pdfnix).fill('What jumps?')
  await page.keyboard.press('Enter')
  await finished(pdfnix)

  const [chat] = lmStudio.chats()
  expect(chat.system_prompt).toContain('[p. N: "exact words"]')

  // The citations are chips; the quote is not in the answer's text.
  const chips = panel(pdfnix).getByTestId('assistant-citation')
  await expect(chips).toHaveText(['p. 1', 'p. 12'])
  await expect(answers(pdfnix)).not.toContainText('quick brown')
  await expect(chips.first()).toHaveAttribute(
    'title',
    'Page 1: “quick brown fox jumps”\nClick to highlight it on the page'
  )

  // LM Studio's figures under the answer, and the context the chat fills.
  const stats = panel(pdfnix).getByTestId('assistant-stats')
  await expect(stats).toContainText('0.25 s TTFT')
  await expect(stats).toContainText('42.5 tok/s')
  await expect(stats).toContainText('4 tokens')
  await expect(panel(pdfnix).getByTestId('assistant-context-usage')).toContainText(
    `104 / ${Number(chat.context_length).toLocaleString('en-US')}`
  )

  // A page-only citation goes to the page.
  const pageNumber = page.getByLabel('Page number')
  await chips.nth(1).click()
  await expect(pageNumber).toHaveValue('12')
  await expect(page.getByTestId('citation-highlight')).toHaveCount(0)

  // A quoted one goes back and highlights the words on page 1.
  await chips.first().click()
  await expect(pageNumber).toHaveValue('1')
  const highlight = page.locator(
    '.pdf-page[data-page-index="0"] [data-testid="citation-highlight"]'
  )
  await expect(highlight).toHaveCount(1)
  await expect(highlight).toBeVisible()
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true')

  // The highlight comes off: the same chip again, Escape (on the chip or on
  // the pages), or a click on the page.
  await chips.first().click()
  await expect(highlight).toHaveCount(0)
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'false')

  await chips.first().click()
  await expect(highlight).toHaveCount(1)
  await chips.first().press('Escape')
  await expect(highlight).toHaveCount(0)

  await chips.first().click()
  await expect(highlight).toHaveCount(1)
  await page.getByRole('region', { name: /^Pages of/ }).focus()
  await page.keyboard.press('Escape')
  await expect(highlight).toHaveCount(0)

  await chips.first().click()
  await expect(highlight).toHaveCount(1)
  const box = await page.getByRole('region', { name: /^Pages of/ }).boundingBox()
  if (!box) throw new Error('pages not shown')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(highlight).toHaveCount(0)

  // Clearing the chat removes the highlight and the gauge.
  await chips.first().click()
  await expect(highlight).toHaveCount(1)
  await panel(pdfnix).getByRole('button', { name: 'Clear chat' }).click()
  await expect(highlight).toHaveCount(0)
  await expect(panel(pdfnix).getByTestId('assistant-context-usage')).toHaveCount(0)
})

test('Whole document sends every page and asks for a larger context', async ({ pdfnix }) => {
  const { page } = pdfnix
  // A context too small for the twelve pages.
  lmStudio.loadedContext = 1024
  await setUp(pdfnix)

  await page.keyboard.press('Control+Shift+A')
  await expect(panel(pdfnix)).toBeVisible()
  await panel(pdfnix).getByRole('button', { name: 'Whole document' }).click()
  await expect(panel(pdfnix).getByRole('button', { name: 'Whole document' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await input(pdfnix).fill('Summarise the report')
  await page.keyboard.press('Enter')
  // LM Studio "reloads" the model at the new size first.
  await expect(panel(pdfnix).getByTestId('assistant-progress')).toContainText(/Loading .*%/)
  await expect(answers(pdfnix)).toHaveText('Here is a simpler version.')

  const [chat] = lmStudio.chats()
  expect(chat.system_prompt).toContain('This is the body text of chapter 12.')
  expect(chat.system_prompt).toContain('all 12 pages')
  expect(chat.context_length).toBe(4096)
  // The smaller instance was unloaded first, so the model is not held twice.
  expect(lmStudio.requests.some((request) => request.path === '/api/v1/models/unload')).toBe(true)
  expect(await page.evaluate(() => window.api.settings.get())).toMatchObject({
    aiContext: 'document'
  })

  // Ctrl+Shift+A closes the panel again.
  await page.keyboard.press('Control+Shift+A')
  await expect(panel(pdfnix)).toHaveCount(0)
})

test('Stop ends a slow answer and closes the connection', async ({ pdfnix }) => {
  lmStudio.answer = Array.from({ length: 200 }, (_, index) => ` word${index}`)
  lmStudio.wordDelayMs = 100
  await setUp(pdfnix)
  await pdfnix.selectWords(0, 'quick', 'fox')
  await menuItem(pdfnix, 'Simplify').click()

  await expect(answers(pdfnix)).toContainText('word3')
  await panel(pdfnix).getByRole('button', { name: 'Stop', exact: true }).first().click()
  await expect(panel(pdfnix).getByTestId('assistant-stopped')).toHaveText('Stopped.')
  await expect.poll(() => lmStudio.closedEarly).toBe(1)
  await expect(answers(pdfnix)).not.toContainText('word199')
  // The input is ready for the next question.
  await expect(panel(pdfnix).getByRole('button', { name: 'Send' })).toBeVisible()
})

test('an unreachable server shows how to start LM Studio', async ({ pdfnix }) => {
  const { page } = pdfnix
  const address = lmStudio.url
  await lmStudio.close()
  await setUp(pdfnix, address)

  await page.keyboard.press('Control+Shift+A')
  await expect(panel(pdfnix)).toContainText("LM Studio's server isn't running")
  await expect(panel(pdfnix).getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(panel(pdfnix).getByRole('button', { name: 'Settings' })).toBeVisible()

  // A question asked meanwhile waits, and Retry sends it once the server is up.
  await input(pdfnix).fill('Hello?')
  await page.keyboard.press('Enter')
  await expect(panel(pdfnix)).toContainText("LM Studio's server isn't running")
  lmStudio = await startFakeLmStudio()
  await page.evaluate((aiServerUrl) => window.api.settings.set({ aiServerUrl }), lmStudio.url)
  await panel(pdfnix).getByRole('button', { name: 'Retry' }).click()
  await expect(answers(pdfnix)).toHaveText('Here is a simpler version.')
  expect(lmStudio.chats()[0].input).toBe('Hello?')
})
