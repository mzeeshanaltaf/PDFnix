import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import type { ChildProcess } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { IPC, type Api, type MenuCommand } from '../../src/shared/api'
import { BUILT_MAIN, FIXTURES, PACKAGED_EXE, ROOT } from './paths'

declare global {
  interface Window {
    api: Api
  }
}

export interface OpenDocument {
  docId: string
  path: string
  fileName: string
  pageCount: number
  revision: number
  modified: boolean
  canUndo: boolean
  canRedo: boolean
  undoName: string | null
  redoName: string | null
}

export interface Annotation {
  annotId: number
  type: string
  page: number
  contents: string
  rect: [number, number, number, number]
}

interface PageWords {
  lines: { words: { text: string }[] }[]
}

/** One running PDFnix with its own throwaway profile and work folder. */
export class Pdfnix {
  /** Kept from the start: Playwright forgets it once the app has closed. */
  private readonly child: ChildProcess

  constructor(
    readonly app: ElectronApplication,
    readonly page: Page,
    /** Folder for files a test creates or changes. */
    readonly work: string,
    /** The app's user-data folder (settings, recovery copies, logs). */
    readonly profile: string
  ) {
    this.child = app.process()
  }

  /** Copies a sample PDF into the work folder and returns its path. */
  copy(name: string, as = name): string {
    const target = join(this.work, as)
    copyFileSync(join(FIXTURES, name), target)
    return target
  }

  /** Opens a file the way File > Open, the command line and Explorer do. */
  async open(path: string): Promise<OpenDocument> {
    await this.app.evaluate(
      ({ BrowserWindow }, { channel, path }) => {
        BrowserWindow.getAllWindows()[0].webContents.send(channel, [path])
      },
      { channel: IPC.filesOpenRequest, path }
    )
    await expect(this.tab(basename(path))).toBeVisible()
    await expect(this.page.locator('.pdf-page img').first()).toBeVisible()
    await expect.poll(async () => Boolean(await this.document(path))).toBe(true)
    return (await this.document(path)) as OpenDocument
  }

  tab(fileName: string): Locator {
    return this.page.getByRole('tab', { name: fileName })
  }

  /** Runs an application-menu command, as clicking it in the menu does. */
  async command(command: MenuCommand): Promise<void> {
    await this.app.evaluate(
      ({ BrowserWindow }, { channel, command }) => {
        BrowserWindow.getAllWindows()[0].webContents.send(channel, command)
      },
      { channel: IPC.menuCommand, command }
    )
  }

  /** Calls the engine with the app's own connection (port and token). */
  async engine<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.page.evaluate(
      async ({ method, path, body }) => {
        const connection = await window.api.engine.getConnection()
        const response = await fetch(`${connection.baseUrl}/v1${path}`, {
          method,
          headers: { 'X-Engine-Token': connection.token, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        })
        return response.json()
      },
      { method, path, body }
    )) as T
  }

  async documents(): Promise<OpenDocument[]> {
    return (await this.engine<{ documents: OpenDocument[] }>('GET', '/docs')).documents
  }

  async document(path: string): Promise<OpenDocument | undefined> {
    const wanted = resolve(path).toLowerCase()
    return (await this.documents()).find((doc) => doc.path.toLowerCase() === wanted)
  }

  async state(path: string): Promise<OpenDocument> {
    const doc = await this.document(path)
    if (!doc) throw new Error(`${path} is not open`)
    return doc
  }

  async annotations(docId: string): Promise<Annotation[]> {
    return this.engine<Annotation[]>('GET', `/docs/${docId}/annotations`)
  }

  /** The words of a page, joined with spaces (lines with newlines). */
  async pageText(docId: string, index: number): Promise<string> {
    const text = await this.engine<PageWords>('GET', `/docs/${docId}/pages/${index}/text`)
    return text.lines.map((line) => line.words.map((word) => word.text).join(' ')).join('\n')
  }

  /** The next native Save dialogs answer with these paths (null = cancelled). */
  async answerSaveDialogs(...paths: (string | null)[]): Promise<void> {
    await this.app.evaluate(({ dialog }, answers) => {
      const queue = [...answers]
      dialog.showSaveDialog = (async () => {
        const path = queue.shift() ?? null
        return { canceled: path === null, filePath: path ?? '' }
      }) as typeof dialog.showSaveDialog
    }, paths)
  }

  /** The next native message boxes answer with these button indexes. */
  async answerMessageBoxes(...responses: number[]): Promise<void> {
    await this.app.evaluate(({ dialog }, answers) => {
      const queue = [...answers]
      const asked: string[] = []
      ;(globalThis as Record<string, unknown>)['__pdfnixAsked'] = asked
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.find(
          (arg) => typeof arg === 'object' && arg !== null && 'message' in arg
        ) as { message: string } | undefined
        asked.push(options?.message ?? '')
        return { response: queue.shift() ?? 0, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    }, responses)
  }

  /** Messages of the native message boxes answered so far. */
  async askedMessages(): Promise<string[]> {
    return this.app.evaluate(
      () => ((globalThis as Record<string, unknown>)['__pdfnixAsked'] as string[]) ?? []
    )
  }

  /** The word's span in a page's text layer. */
  word(pageIndex: number, text: string): Locator {
    return (
      this.page
        .locator(`.pdf-text-layer[data-page-index="${pageIndex}"] span`)
        // Spans carry the space after their word.
        .filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) })
        .first()
    )
  }

  /** Drags across the text layer from the first to the last word given. */
  async selectWords(pageIndex: number, first: string, last = first): Promise<void> {
    const start = await this.word(pageIndex, first).boundingBox()
    const end = await this.word(pageIndex, last).boundingBox()
    if (!start || !end) throw new Error(`words ${first}…${last} are not on page ${pageIndex}`)
    await this.page.mouse.move(start.x + 1, start.y + start.height / 2)
    await this.page.mouse.down()
    await this.page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
    await this.page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, { steps: 4 })
    await this.page.mouse.up()
  }

  /** Window coordinates of a point given in PDF points on a page. */
  async pointOnPage(
    pageIndex: number,
    widthPt: number,
    x: number,
    y: number
  ): Promise<{ x: number; y: number }> {
    const box = await this.page.locator(`.pdf-page[data-page-index="${pageIndex}"]`).boundingBox()
    if (!box) throw new Error(`page ${pageIndex} is not shown`)
    const scale = box.width / widthPt
    return { x: box.x + x * scale, y: box.y + y * scale }
  }

  /** Closes the window the way its close button and Alt+F4 do. */
  async closeWindow(): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  }

  /** Resolves when the app has exited; rejects after `timeout` ms. */
  async exited(timeout = 20_000): Promise<number | null> {
    const child = this.child
    if (child.exitCode !== null) return child.exitCode
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('the app did not exit')), timeout)
      child.once('exit', (code) => {
        clearTimeout(timer)
        done(code)
      })
    })
  }

  /** Quits at once, without the unsaved-changes question. */
  async kill(): Promise<void> {
    const child = this.child
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((done) => child.once('exit', () => done()))
    await this.app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await exited
  }
}

/** Starts PDFnix (the build in out/, or the packaged app) with its own profile. */
export async function launch(
  profile: string,
  packaged: boolean
): Promise<{ app: ElectronApplication; page: Page }> {
  const needed = packaged ? PACKAGED_EXE : BUILT_MAIN
  if (!existsSync(needed)) {
    throw new Error(`${needed} is missing; run \`pnpm ${packaged ? 'dist:dir' : 'build'}\` first.`)
  }
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  // Inherited from VS Code's terminal, it would start Electron as plain Node.
  delete env['ELECTRON_RUN_AS_NODE']
  delete env['ELECTRON_RENDERER_URL']
  env['PDFNIX_USER_DATA'] = profile
  const app = packaged
    ? await electron.launch({ executablePath: PACKAGED_EXE, env, timeout: 60_000 })
    : await electron.launch({ args: [ROOT], cwd: ROOT, env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof window.api?.engine?.getConnection === 'function')
  // The window shows before the engine is ready; the tests need both.
  await page.evaluate(() => window.api.engine.getConnection())
  await expect(page.getByRole('toolbar', { name: 'Main toolbar' })).toBeVisible()
  return { app, page }
}

export const test = base.extend<{ pdfnix: Pdfnix }>({
  // eslint-disable-next-line no-empty-pattern
  pdfnix: async ({}, use, testInfo) => {
    const root = mkdtempSync(join(tmpdir(), 'pdfnix-e2e-'))
    const work = join(root, 'work')
    mkdirSync(work)
    const profile = join(root, 'profile')
    const { app, page } = await launch(profile, testInfo.project.name === 'packaged')
    const pdfnix = new Pdfnix(app, page, work, profile)
    try {
      await use(pdfnix)
    } finally {
      await pdfnix.kill()
      // The engine may still be letting go of its log file.
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          rmSync(root, { recursive: true, force: true })
          break
        } catch {
          await new Promise((done) => setTimeout(done, 250))
        }
      }
    }
  }
})

export { expect }
