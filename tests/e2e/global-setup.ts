import { execFileSync } from 'child_process'
import { join } from 'path'
import { FIXTURES, ROOT } from './paths'

/** Writes the sample PDFs (with the engine's Python and PyMuPDF). */
export default function globalSetup(): void {
  execFileSync(
    'uv',
    [
      'run',
      '--directory',
      'engine',
      'python',
      join(ROOT, 'tests', 'e2e', 'make_fixtures.py'),
      FIXTURES
    ],
    { cwd: ROOT, stdio: 'inherit' }
  )
}
