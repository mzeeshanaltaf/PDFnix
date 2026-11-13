/** Pure helpers for the comments panel. */

import type { Annotation } from '@/api/engine'

export type CommentFilter = 'all' | 'note' | 'highlight' | 'underline' | 'strikeout' | 'other'

export const COMMENT_FILTERS: { value: CommentFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'note', label: 'Notes' },
  { value: 'highlight', label: 'Highlights' },
  { value: 'underline', label: 'Underlines' },
  { value: 'strikeout', label: 'Strikeouts' },
  { value: 'other', label: 'Other' }
]

const NAMED = new Set(['note', 'highlight', 'underline', 'strikeout'])

/** What the panel lists: every note, and every other annotation that has a comment. */
export function isListed(annotation: Annotation): boolean {
  return annotation.type === 'note' || annotation.contents.trim() !== ''
}

export function matchesFilter(annotation: Annotation, filter: CommentFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'other') return !NAMED.has(annotation.type)
  return annotation.type === filter
}

export interface CommentGroup {
  page: number
  annotations: Annotation[]
}

/** Listed annotations that pass the filter, grouped by page in page order. */
export function groupComments(
  annotations: readonly Annotation[],
  filter: CommentFilter
): CommentGroup[] {
  const groups = new Map<number, Annotation[]>()
  for (const annotation of annotations) {
    if (!isListed(annotation) || !matchesFilter(annotation, filter)) continue
    const list = groups.get(annotation.page)
    if (list) list.push(annotation)
    else groups.set(annotation.page, [annotation])
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([page, list]) => ({
      page,
      // Top to bottom on the page.
      annotations: list.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0])
    }))
}

/**
 * Replaces the annotations of `pages` in `all` with `fresh` (the newly fetched
 * annotations of those pages), keeping page order.
 */
export function mergePages(
  all: readonly Annotation[],
  pages: ReadonlySet<number>,
  fresh: readonly Annotation[]
): Annotation[] {
  return [...all.filter((annotation) => !pages.has(annotation.page)), ...fresh].sort(
    (a, b) => a.page - b.page
  )
}
