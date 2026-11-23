import type { PageCode } from '@/api/engine'
import type { FoundCode } from '@/viewer/codeScan'
import { externalLinkTarget } from '../../../shared/links'

export interface CodeGroup {
  page: number
  codes: FoundCode[]
}

/** Codes grouped by page, pages in order (the input is already in page order). */
export function groupCodes(found: readonly FoundCode[]): CodeGroup[] {
  const groups: CodeGroup[] = []
  for (const item of found) {
    const last = groups[groups.length - 1]
    if (last && last.page === item.page) last.codes.push(item)
    else groups.push({ page: item.page, codes: [item] })
  }
  return groups
}

/** The web or mail address a code holds, if the app may open it. */
export function codeLinkTarget(code: PageCode): string | null {
  return code.binary ? null : externalLinkTarget(code.text)
}

/** All codes as plain text, for "Copy all". */
export function codesAsText(found: readonly FoundCode[]): string {
  return found
    .map((item) => `Page ${item.page + 1} · ${item.code.format}\n${item.code.text}`)
    .join('\n\n')
}
