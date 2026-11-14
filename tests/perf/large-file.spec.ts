/**
 * Performance check with a 1,000-page, ~500 MB PDF: `pnpm test:perf`.
 * Not part of the regular end-to-end run (it writes half a gigabyte and takes
 * minutes). Prints timings and memory; fails if memory grows without bound.
 */
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, test, type Pdfnix } from '../e2e/harness'
import { ROOT } from '../e2e/paths'

const LARGE = join(tmpdir(), 'pdfnix-perf', 'large-1000.pdf')
const MB = 1024 * 1024

test.setTimeout(20 * 60_000)

interface Metric {
  type: string
  memory: { workingSetSize: number }
}

async function memory(pdfnix: Pdfnix): Promise<Record<string, number>> {
  const metrics = (await pdfnix.app.evaluate(({ app }) => app.getAppMetrics())) as Metric[]
  const byType: Record<string, number> = {}
  for (const metric of metrics) {
    byType[metric.type] = (byType[metric.type] ?? 0) + metric.memory.workingSetSize / 1024
  }
  const { pid } = await pdfnix.engine<{ pid: number }>('GET', '/health')
  const engineBytes = Number(
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-Process -Id ${pid}).WorkingSet64`
    ])
      .toString()
      .trim()
  )
  byType['Engine'] = engineBytes / MB
  for (const key of Object.keys(byType)) byType[key] = Math.round(byType[key])
  return byType
}

test('a 1,000-page, 500 MB PDF stays responsive and bounded in memory', async ({ pdfnix }) => {
  const { page } = pdfnix
  execFileSync(
    'uv',
    [
      'run',
      '--directory',
      'engine',
      'python',
      join(ROOT, 'tests', 'perf', 'make_large.py'),
      LARGE,
      '1000'
    ],
    {
      cwd: ROOT,
      stdio: 'inherit'
    }
  )

  const started = Date.now()
  const doc = await pdfnix.open(LARGE)
  const openMs = Date.now() - started
  expect(doc.pageCount).toBe(1000)
  const before = await memory(pdfnix)

  // Scroll from the first page to the last in big steps, letting pages render.
  const viewer = await page.locator('.pdf-page').first().boundingBox()
  if (!viewer) throw new Error('no page')
  await page.mouse.move(viewer.x + viewer.width / 2, viewer.y + 200)
  const pageNumber = page.getByLabel('Page number')
  const scrollStarted = Date.now()
  for (let step = 0; step < 400 && (await pageNumber.inputValue()) !== '1000'; step++) {
    await page.mouse.wheel(0, 2600)
    await page.waitForTimeout(30)
  }
  const scrollMs = Date.now() - scrollStarted
  await expect(page.locator('.pdf-page img').first()).toBeVisible()
  const afterScroll = await memory(pdfnix)

  // Jump back and forth through the document by page number.
  for (const target of ['1', '500', '250', '999', '1']) {
    await pageNumber.fill(target)
    await pageNumber.press('Enter')
    await expect(
      page.locator(`.pdf-page[data-page-index="${Number(target) - 1}"] img`)
    ).toBeVisible({
      timeout: 15_000
    })
  }

  // Thumbnails: only the visible ones are made.
  await page.keyboard.press('F4')
  const thumbnails = page.locator(
    '[aria-label="Thumbnails"] img, [aria-label="Page thumbnails"] img'
  )
  await page.waitForTimeout(1500)
  const thumbnailCount = await thumbnails.count()
  const afterJumps = await memory(pdfnix)

  const report = { openMs, scrollMs, thumbnailCount, before, afterScroll, afterJumps }
  console.log(JSON.stringify(report, null, 2))
  test.info().annotations.push({ type: 'measurements', description: JSON.stringify(report) })

  expect(openMs).toBeLessThan(15_000)
  expect(thumbnailCount).toBeLessThan(60)
  // Renderer image cache is capped at 192 MB; allow the rest of Chromium.
  expect(afterJumps['Tab'] ?? 0).toBeLessThan(1200)
  expect(afterJumps['Engine']).toBeLessThan(1500)
})
