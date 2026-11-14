import { tmpdir } from 'os'
import { join, resolve } from 'path'

export const ROOT = resolve(__dirname, '..', '..')
/** Sample PDFs written by make_fixtures.py; tests copy them before changing them. */
export const FIXTURES = join(tmpdir(), 'pdfnix-e2e-fixtures')
/** The unpacked packaged app (`pnpm dist:dir`), used by the "packaged" project. */
export const PACKAGED_EXE = join(ROOT, 'release', 'win-unpacked', 'PDFnix.exe')
/** The built app code (`pnpm build`), used by the "dev" project. */
export const BUILT_MAIN = join(ROOT, 'out', 'main', 'index.js')
