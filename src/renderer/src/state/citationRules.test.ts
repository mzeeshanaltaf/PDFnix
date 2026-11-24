import { describe, expect, it } from 'vitest'
import {
  citationLabel,
  citationQuotes,
  linkCitations,
  parseCitationHref,
  quoteSearches
} from './citationRules'

describe('linkCitations', () => {
  it('turns a page citation into a chip link', () => {
    expect(linkCitations('The fee is due in May [p. 3].', 10)).toBe(
      'The fee is due in May [p. 3](#cite-3).'
    )
  })

  it('keeps the quote with the link, encoded so the link stays whole', () => {
    const out = linkCitations('Due soon [p. 2: "payment (in full) is due"].', 10)
    expect(out).toBe('Due soon [p. 2](#cite-2?q=payment%20%28in%20full%29%20is%20due).')
    const href = /\((#cite-[^)]*)\)/.exec(out)![1]
    expect(parseCitationHref(href)).toEqual({ page: 1, quote: 'payment (in full) is due' })
  })

  it('reads the ways models write it: p.3, page 3, curly quotes, a comma before the quote', () => {
    expect(linkCitations('[p.3]', 5)).toBe('[p. 3](#cite-3)')
    expect(linkCitations('[Page 4]', 5)).toBe('[p. 4](#cite-4)')
    expect(linkCitations('[p. 1: “Hello there”]', 5)).toBe('[p. 1](#cite-1?q=Hello%20there)')
    expect(linkCitations('[p. 1, "Hello"]', 5)).toBe('[p. 1](#cite-1?q=Hello)')
  })

  it('splits lists and keeps ranges', () => {
    expect(linkCitations('[pp. 3, 5]', 9)).toBe('[p. 3](#cite-3) [p. 5](#cite-5)')
    expect(linkCitations('[pages 2-4]', 9)).toBe('[pp. 2–4](#cite-2-4)')
    expect(linkCitations('[p. 2 and 7]', 9)).toBe('[p. 2](#cite-2) [p. 7](#cite-7)')
  })

  it('leaves pages outside the document and code alone', () => {
    expect(linkCitations('See [p. 12].', 10)).toBe('See [p. 12].')
    expect(linkCitations('See [p. 0].', 10)).toBe('See [p. 0].')
    expect(linkCitations('Write `[p. 3]` or\n```\n[p. 3]\n```\n[p. 3]', 10)).toBe(
      'Write `[p. 3]` or\n```\n[p. 3]\n```\n[p. 3](#cite-3)'
    )
  })

  it('does not touch ordinary links and brackets', () => {
    const text = 'A [link](https://example.com) and [note] and [page break].'
    expect(linkCitations(text, 10)).toBe(text)
  })
})

describe('found quotes', () => {
  it('lists each quote once with the pages the model named, even outside the document', () => {
    const text =
      'A [p. 5: "one two three"], B [p. 2], C [p. 1, 3: "four five"] D [p. 9: "one two three"]'
    expect(citationQuotes(text)).toEqual([
      { quote: 'one two three', pages: [4] },
      { quote: 'four five', pages: [0, 2] }
    ])
  })

  it('points a quoted citation at the page where its words are', () => {
    // The model wrote section 5 of a 4-page document; the words are on page 3.
    const text = 'Pets need consent [p. 5: "No pets may be kept"].'
    expect(linkCitations(text, 4)).toBe(text)
    expect(linkCitations(text, 4, { 'No pets may be kept': 2 })).toBe(
      'Pets need consent [p. 3](#cite-3?q=No%20pets%20may%20be%20kept).'
    )
    // Not found: as the model wrote it.
    expect(linkCitations('X [p. 2: "gone"]', 4, { gone: null })).toBe('X [p. 2](#cite-2?q=gone)')
  })
})

describe('parseCitationHref', () => {
  it('reads pages and ranges, and ignores other links', () => {
    expect(parseCitationHref('#cite-3')).toEqual({ page: 2 })
    expect(parseCitationHref('#cite-2-4')).toEqual({ page: 1, lastPage: 3 })
    expect(parseCitationHref('https://example.com')).toBeNull()
    expect(parseCitationHref('#cite-x')).toBeNull()
    expect(parseCitationHref(undefined)).toBeNull()
  })

  it('survives a broken quote encoding', () => {
    expect(parseCitationHref('#cite-3?q=%E0%A4%A')).toEqual({ page: 2 })
  })
})

describe('citationLabel', () => {
  it('names one page or a range', () => {
    expect(citationLabel({ page: 2 })).toBe('p. 3')
    expect(citationLabel({ page: 2, lastPage: 4 })).toBe('pp. 3–5')
  })
})

describe('quoteSearches', () => {
  it('tries the whole quote first, then its ends', () => {
    const quote = 'the annual fee must be paid before the thirty first of May each year'
    const searches = quoteSearches(quote)
    expect(searches[0]).toBe(quote)
    expect(searches).toContain('the annual fee must be paid before the')
    expect(searches).toContain('first of May each year')
  })

  it('tidies quotes, punctuation at the ends and spaces', () => {
    expect(quoteSearches('  “Total   due:  $40.” ')[0]).toBe('Total due: $40')
  })

  it('uses the longest piece of a quote with an ellipsis', () => {
    const searches = quoteSearches('short bit … the much longer piece of the quote')
    expect(searches[1]).toBe('the much longer piece of the quote')
  })

  it('drops pieces too short to find anything', () => {
    expect(quoteSearches('a.')).toEqual([])
  })
})
