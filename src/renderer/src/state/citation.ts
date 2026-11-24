/**
 * The page text an assistant citation points at: clicking a chip in an answer
 * goes to the cited page and highlights the quoted words there. One highlight
 * at a time, app-wide. It goes away when the same chip is clicked again,
 * Escape is pressed, the page is clicked, another citation is shown, the chat
 * is cleared or the document changes (the viewer drops a highlight whose
 * revision is no longer the tab's).
 */

import { toast } from 'sonner'
import { create } from 'zustand'
import { engine, type Quad } from '@/api/engine'
import { getViewer } from '../viewer/controller'
import { quadBounds } from '../viewer/geometry'
import { quoteSearches, type Citation } from './citationRules'
import { getTab } from './tabs'

export interface CitationHighlight {
  tabId: string
  /** 0-based page. */
  page: number
  quads: Quad[]
  /** The tab's revision when the quote was found. */
  revision: number
  /** Which citation it shows (`citationKey`), so its chip can show it is on. */
  key: string
}

interface CitationState {
  highlight: CitationHighlight | null
}

export const useCitation = create<CitationState>(() => ({ highlight: null }))

/** Names a citation of a tab: chips with the same page and quote share it. */
export function citationKey(tabId: string, citation: Citation): string {
  return `${tabId}|${citation.page}|${citation.lastPage ?? ''}|${citation.quote ?? ''}`
}

/** Removes the highlight (of one tab, or any). True if there was one to remove. */
export function clearCitation(tabId?: string): boolean {
  const current = useCitation.getState().highlight
  if (current && (tabId === undefined || current.tabId === tabId)) {
    latest += 1
    useCitation.setState({ highlight: null })
    return true
  }
  return false
}

/** Counts `showCitation` calls, so a slow search does not undo a newer click. */
let latest = 0

/**
 * Finds a quote in the document. The search texts are tried best first (the
 * whole quote, then parts of it); the first that matches anywhere wins, on a
 * page in `preferred` if it is there. A quote found on another page is still
 * used: the text is a better guide than the page number the model wrote.
 */
export async function findQuote(
  docId: string,
  quote: string,
  preferred: readonly number[]
): Promise<{ page: number; quads: Quad[] } | null> {
  for (const query of quoteSearches(quote)) {
    const result = await engine.search(docId, query, { matchCase: false, wholeWord: false })
    const hit = result.hits.find((item) => preferred.includes(item.page)) ?? result.hits[0]
    if (hit) return { page: hit.page, quads: hit.quads }
  }
  return null
}

/**
 * Where each quote in an answer is in the document (0-based page, or null
 * when it cannot be found), for `linkCitations`.
 */
export async function locateQuotes(
  docId: string,
  quotes: readonly { quote: string; pages: number[] }[]
): Promise<Record<string, number | null>> {
  const result: Record<string, number | null> = {}
  for (const { quote, pages } of quotes.slice(0, MAX_QUOTES)) {
    try {
      result[quote] = (await findQuote(docId, quote, pages))?.page ?? null
    } catch {
      result[quote] = null
    }
  }
  return result
}

/** An answer's quotes looked up after it ends; more than this are left as cited. */
const MAX_QUOTES = 24

/**
 * Goes to a citation's page and highlights its quote there, if it can be
 * found. The chip of the citation already shown turns its highlight off.
 */
export async function showCitation(tabId: string, citation: Citation): Promise<void> {
  const tab = getTab(tabId)
  if (!tab) return
  const key = citationKey(tabId, citation)
  if (useCitation.getState().highlight?.key === key) {
    clearCitation()
    return
  }
  clearCitation()
  const call = ++latest
  const last = Math.min(citation.lastPage ?? citation.page, tab.pageCount - 1)
  const first = Math.min(citation.page, last)

  let found: { page: number; quads: Quad[] } | null = null
  if (citation.quote) {
    const pages = Array.from({ length: last - first + 1 }, (_, index) => first + index)
    try {
      found = await findQuote(tab.docId, citation.quote, pages)
    } catch {
      found = null
    }
  }
  if (call !== latest) return
  const now = getTab(tabId)
  if (!now) return
  const viewer = getViewer(tabId)

  if (!found) {
    viewer?.goToPage(first)
    if (citation.quote) {
      toast(`The quoted text was not found on page ${first + 1}`, {
        description: 'Showing the page instead.',
        duration: 3000
      })
    }
    return
  }
  useCitation.setState({
    highlight: { tabId, page: found.page, quads: found.quads, revision: now.revision, key }
  })
  const boxes = found.quads.map(quadBounds)
  viewer?.reveal(found.page, [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3]))
  ])
}
