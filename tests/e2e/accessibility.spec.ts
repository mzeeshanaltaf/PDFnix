import axe, { type AxeResults } from 'axe-core'
import type { Page } from '@playwright/test'
import { expect, test } from './harness'

/**
 * Serious and critical axe findings, as "screen · rule: element" lines.
 * axe-core is evaluated in the window directly (the @axe-core/playwright
 * wrapper opens a new page, which Electron does not support).
 */
async function scan(page: Page, what: string): Promise<string[]> {
  // Dialogs fade and zoom in; colours measured mid-animation are meaningless.
  // (A cancelled animation's `finished` rejects; that is fine too.)
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)))
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axe.source)
  const results = (await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run(
      // The PDF page itself: a picture with a transparent text layer over it.
      { exclude: [['.pdf-page']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }
    )
  )) as AxeResults
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap((violation) =>
      violation.nodes.map(
        (node) =>
          `${what} · ${violation.id}: ${node.target.join(' ')} — ${node.failureSummary?.split('\n')[1]?.trim() ?? ''}`
      )
    )
}

for (const scheme of ['light', 'dark'] as const) {
  test(`main screens have no serious accessibility problems (${scheme})`, async ({ pdfnix }) => {
    const { page } = pdfnix
    await page.emulateMedia({ colorScheme: scheme })
    const found: string[] = []

    found.push(...(await scan(page, 'start page')))

    await pdfnix.open(pdfnix.copy('report.pdf'))
    await page.keyboard.press('F4')
    found.push(...(await scan(page, 'document')))

    await page.keyboard.press('Control+,')
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    found.push(...(await scan(page, 'settings')))
    await page.keyboard.press('Escape')

    await pdfnix.command('help.about')
    await expect(page.getByRole('dialog', { name: 'PDFnix' })).toBeVisible()
    found.push(...(await scan(page, 'about')))
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+/')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    found.push(...(await scan(page, 'shortcuts')))

    console.log(found.join('\n'))
    expect(found).toEqual([])
  })
}
