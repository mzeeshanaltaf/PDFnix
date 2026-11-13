import { basename, dirname, isAbsolute, resolve } from 'path'
import type { RecentFile } from '../shared/api'

/**
 * Pure helpers for the paths main deals with: command-line arguments and the
 * recent-files list. Kept free of Electron so they can be unit-tested.
 */

export const MAX_RECENT_FILES = 15

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/** Windows paths are case-insensitive; compare them that way. */
export function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}

/**
 * The PDF files named on a command line. `argv[0]` is the executable. Flags
 * (Electron and Chromium add several) and anything that is not a `.pdf` are
 * ignored. Relative paths are resolved against `cwd`.
 */
export function pdfPathsFromArgv(argv: readonly string[], cwd: string): string[] {
  const paths: string[] = []
  for (const argument of argv.slice(1)) {
    if (!argument || argument.startsWith('-') || !isPdfPath(argument)) continue
    const path = isAbsolute(argument) ? resolve(argument) : resolve(cwd, argument)
    if (!paths.some((known) => samePath(known, path))) paths.push(path)
  }
  return paths
}

/** `list` with `path` moved (or added) to the front, without duplicates, capped. */
export function addToRecent(
  list: readonly string[],
  path: string,
  max = MAX_RECENT_FILES
): string[] {
  const absolute = resolve(path)
  return [absolute, ...list.filter((entry) => !samePath(entry, absolute))].slice(0, max)
}

export function removeFromRecent(list: readonly string[], path: string): string[] {
  return list.filter((entry) => !samePath(entry, path))
}

export function toRecentFile(path: string): RecentFile {
  return { path, name: basename(path), folder: dirname(path) }
}
