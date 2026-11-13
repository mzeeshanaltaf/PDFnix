import type { SearchHit } from '@/api/engine'

/** A row of the result list: a page heading, or a hit. */
export type SearchRow =
  { kind: 'page'; page: number; count: number } | { kind: 'hit'; index: number; hit: SearchHit }

/** The hits as list rows: a heading per page, followed by that page's hits. */
export function groupHits(hits: readonly SearchHit[]): SearchRow[] {
  const rows: SearchRow[] = []
  let heading: Extract<SearchRow, { kind: 'page' }> | null = null
  hits.forEach((hit, index) => {
    if (!heading || heading.page !== hit.page) {
      heading = { kind: 'page', page: hit.page, count: 0 }
      rows.push(heading)
    }
    heading.count += 1
    rows.push({ kind: 'hit', index, hit })
  })
  return rows
}
