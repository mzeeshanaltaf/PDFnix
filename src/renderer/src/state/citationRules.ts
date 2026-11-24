/**
 * Citations in the assistant's answers. The system prompt asks the model to
 * cite the pages it used as `[p. 3]`, or with a short quote as
 * `[p. 3: "exact words"]`. Before an answer is shown as Markdown, each
 * citation becomes a link to `#cite-…`, which the panel draws as a chip that
 * goes to the page and highlights the quote. Pure.
 */

/** What a citation chip points at. */
export interface Citation {
  /** 0-based page index. */
  page: number
  /** The last page of a range ("pp. 3–5"), 0-based; absent for one page. */
  lastPage?: number
  /** Words the model quoted from the page, to highlight there. */
  quote?: string
}

const HREF_PREFIX = '#cite-'

/**
 * `[p. 3]`, `[p.3]`, `[pp. 3-5]`, `[page 3]`, `[pages 3, 5]`, `[p. 3 and 7]`,
 * each optionally followed by `: "quote"` (straight or curly quotes).
 */
const CITATION =
  /\[(?:pp?|pages?)\.?\s*(\d+(?:\s*(?:,|–|—|-|and|&)\s*\d+)*)(?:\s*[:,]\s*["“„]([^"”\]\n]{1,400})["”])?\s*\]/gi

/** Characters that would end a Markdown link destination early. */
function encodeForHref(text: string): string {
  return encodeURIComponent(text).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function citationHref(citation: Citation): string {
  const pages =
    citation.lastPage === undefined
      ? `${citation.page + 1}`
      : `${citation.page + 1}-${citation.lastPage + 1}`
  return citation.quote === undefined
    ? `${HREF_PREFIX}${pages}`
    : `${HREF_PREFIX}${pages}?q=${encodeForHref(citation.quote)}`
}

/** Reads a chip's link back; null for any other link. */
export function parseCitationHref(href: string | undefined): Citation | null {
  if (!href?.startsWith(HREF_PREFIX)) return null
  const match = /^(\d+)(?:-(\d+))?(?:\?q=(.*))?$/.exec(href.slice(HREF_PREFIX.length))
  if (!match) return null
  const page = Number(match[1]) - 1
  const lastPage = match[2] === undefined ? undefined : Number(match[2]) - 1
  let quote: string | undefined
  if (match[3] !== undefined) {
    try {
      quote = decodeURIComponent(match[3])
    } catch {
      quote = undefined
    }
  }
  return {
    page,
    ...(lastPage !== undefined && lastPage > page && { lastPage }),
    ...(quote && { quote })
  }
}

/** The chip's text: "p. 3", "pp. 3–5". */
export function citationLabel(citation: Citation): string {
  return citation.lastPage === undefined
    ? `p. ${citation.page + 1}`
    : `pp. ${citation.page + 1}–${citation.lastPage + 1}`
}

/** The page numbers a citation's list names, as written ("3, 5", "3-5", "3 and 7"). */
function citedPages(list: string, pageCount: number): Citation[] {
  const valid = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= pageCount
  const result: Citation[] = []
  for (const part of list.split(/\s*(?:,|and|&)\s*/i)) {
    const range = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(part.trim())
    if (range) {
      const first = Number(range[1])
      const last = Number(range[2])
      if (valid(first) && valid(last) && last >= first) {
        result.push(last === first ? { page: first - 1 } : { page: first - 1, lastPage: last - 1 })
      }
      continue
    }
    const n = Number(part.trim())
    if (valid(n)) result.push({ page: n - 1 })
  }
  return result
}

/** Calls `visit` for each citation outside code; returns the text with each replaced. */
function eachCitation(
  markdown: string,
  visit: (whole: string, list: string, quote: string | undefined) => string
): string {
  // Split off code so a "[p. 3]" inside it stays text.
  const parts = markdown.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
  return parts
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(CITATION, (whole, list: string, quote: string | undefined) =>
            visit(whole, list, quote)
          )
    )
    .join('')
}

/**
 * The quotes in an answer's citations, each once, with the 0-based pages the
 * model named for it (in or out of the document), in order.
 */
export function citationQuotes(markdown: string): { quote: string; pages: number[] }[] {
  const found: { quote: string; pages: number[] }[] = []
  eachCitation(markdown, (whole, list, quote) => {
    const clean = quote?.trim()
    if (clean && !found.some((item) => item.quote === clean)) {
      const pages = citedPages(list, Number.MAX_SAFE_INTEGER).map((citation) => citation.page)
      found.push({ quote: clean, pages })
    }
    return whole
  })
  return found
}

/**
 * The answer with each citation turned into Markdown links (`[p. 3](#cite-3)`).
 * A quote goes with the first page of the citation.
 *
 * `quotePages` gives the page (0-based) where each quote was found in the
 * document. A found quote's chip points there, whatever number the model
 * wrote: models sometimes cite a section number as the page. Otherwise page
 * numbers outside the document are left as written. Code is left alone.
 */
export function linkCitations(
  markdown: string,
  pageCount: number,
  quotePages: Readonly<Record<string, number | null>> = {}
): string {
  return eachCitation(markdown, (whole, list, quote) => {
    const cleanQuote = quote?.trim()
    const foundOn = cleanQuote ? quotePages[cleanQuote] : undefined
    const citations =
      typeof foundOn === 'number' && foundOn >= 0 && foundOn < pageCount
        ? [{ page: foundOn }]
        : citedPages(list, pageCount)
    if (citations.length === 0) return whole
    return citations
      .map((citation, at) => {
        const full: Citation =
          at === 0 && cleanQuote ? { ...citation, quote: cleanQuote } : citation
        return `[${citationLabel(full)}](${citationHref(full)})`
      })
      .join(' ')
  })
}

/**
 * The texts to search for, best first: the whole quote, then its longest
 * piece between "…", then its first and last few words (a model's quote is
 * often close but not exact at one end).
 */
export function quoteSearches(quote: string): string[] {
  const tidy = (text: string): string =>
    text
      .replace(/[“”„]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[\s"'.,;:!?…]+|[\s"'.,;:!?…]+$/g, '')
  const result: string[] = []
  const add = (text: string): void => {
    const clean = tidy(text)
    if (clean.length >= 3 && !result.includes(clean)) result.push(clean)
  }
  const whole = tidy(quote)
  add(whole)
  const pieces = whole.split(/\s*(?:\.\.\.|…)\s*/).filter((piece) => piece.trim() !== '')
  const longest = pieces.reduce((best, piece) => (piece.length > best.length ? piece : best), '')
  add(longest)
  const words = longest.split(' ')
  for (const size of [8, 5]) {
    if (words.length > size) {
      add(words.slice(0, size).join(' '))
      add(words.slice(-size).join(' '))
    }
  }
  return result
}
