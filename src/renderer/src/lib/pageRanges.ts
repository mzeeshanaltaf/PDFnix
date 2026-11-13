/**
 * Page ranges as people type them: "1-3, 7, 10-" (1-based, inclusive; "10-"
 * runs to the last page, "-3" from the first). The app works with 0-based
 * indexes, so parsing returns those.
 */

export type ParsedPages = { ok: true; pages: number[] } | { ok: false; error: string }
export type ParsedGroups = { ok: true; groups: number[][] } | { ok: false; error: string }

const PART = /^(\d*)\s*(?:(-)\s*(\d*))?$/

/** One comma-separated part: its pages (0-based, ascending) or an error. */
function parsePart(part: string, pageCount: number): number[] | string {
  const match = PART.exec(part)
  if (!match || (match[1] === '' && match[3] === '')) {
    return `"${part}" is not a page or range.`
  }
  const [, startText, dash, endText] = match
  const start = startText === '' ? 1 : Number(startText)
  const end = dash ? (endText === '' ? pageCount : Number(endText)) : start
  for (const number of [start, end]) {
    if (number < 1 || number > pageCount) {
      return pageCount === 1
        ? `There is only page 1.`
        : `Page ${number} does not exist; pages are 1 to ${pageCount}.`
    }
  }
  if (end < start) return `"${part}" runs backwards.`
  return Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset)
}

function parts(text: string): string[] {
  return text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** The pages named by `text`, 0-based, ascending, each once. */
export function parsePageRanges(text: string, pageCount: number): ParsedPages {
  const items = parts(text)
  if (items.length === 0) return { ok: false, error: 'Enter the pages, for example 1-3, 7.' }
  const pages = new Set<number>()
  for (const item of items) {
    const result = parsePart(item, pageCount)
    if (typeof result === 'string') return { ok: false, error: result }
    for (const page of result) pages.add(page)
  }
  return { ok: true, pages: [...pages].sort((a, b) => a - b) }
}

/** Each comma-separated part as its own group, in the order typed (for splitting). */
export function parsePageGroups(text: string, pageCount: number): ParsedGroups {
  const items = parts(text)
  if (items.length === 0)
    return { ok: false, error: 'Enter the ranges, for example 1-3, 4-9, 10-.' }
  const groups: number[][] = []
  for (const item of items) {
    const result = parsePart(item, pageCount)
    if (typeof result === 'string') return { ok: false, error: result }
    groups.push(result)
  }
  return { ok: true, groups }
}

/** 0-based pages as a short 1-based range text: [0, 1, 2, 6] → "1-3, 7". */
export function formatPageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const out: string[] = []
  let index = 0
  while (index < sorted.length) {
    let end = index
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++
    out.push(end === index ? `${sorted[index] + 1}` : `${sorted[index] + 1}-${sorted[end] + 1}`)
    index = end + 1
  }
  return out.join(', ')
}
