/**
 * The words of each page, for the text layer. Fetched lazily for pages that
 * are on screen and kept in a small least-recently-used cache.
 */

import { engine, isAbortError, type PageText } from '@/api/engine'

export type TextFetcher = (docId: string, page: number, signal: AbortSignal) => Promise<PageText>

interface Pending {
  waiters: number
  controller: AbortController
}

function keyOf(docId: string, page: number, revision: number): string {
  return `${docId}|${page}|${revision}`
}

export class PageTextStore {
  /** In least-recently-used order. */
  private readonly entries = new Map<string, PageText>()
  private readonly pending = new Map<string, Pending>()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly fetcher: TextFetcher,
    private readonly maxPages: number
  ) {}

  get size(): number {
    return this.entries.size
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  peek(docId: string, page: number, revision: number): PageText | null {
    return this.entries.get(keyOf(docId, page, revision)) ?? null
  }

  /** Loads a page's text unless it is cached. Returns a function that withdraws the request. */
  request(docId: string, page: number, revision: number): () => void {
    const key = keyOf(docId, page, revision)
    const cached = this.entries.get(key)
    if (cached) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return () => {}
    }

    let waiting = this.pending.get(key)
    if (!waiting) {
      const started: Pending = { waiters: 0, controller: new AbortController() }
      waiting = started
      this.pending.set(key, started)
      this.fetcher(docId, page, started.controller.signal)
        .then((text) => {
          if (this.pending.get(key) !== started) return
          this.pending.delete(key)
          this.entries.set(key, text)
          while (this.entries.size > this.maxPages) {
            const oldest = this.entries.keys().next().value
            if (oldest === undefined) break
            this.entries.delete(oldest)
          }
          for (const listener of [...this.listeners]) listener()
        })
        .catch((error: unknown) => {
          if (this.pending.get(key) === started) this.pending.delete(key)
          if (!isAbortError(error)) console.warn('Could not load page text', error)
        })
    }
    waiting.waiters += 1

    const current = waiting
    let released = false
    return () => {
      if (released) return
      released = true
      current.waiters -= 1
      if (current.waiters <= 0 && this.pending.get(key) === current) {
        this.pending.delete(key)
        current.controller.abort()
      }
    }
  }

  dropDocument(docId: string): void {
    for (const [key, waiting] of this.pending) {
      if (key.startsWith(`${docId}|`)) {
        this.pending.delete(key)
        waiting.controller.abort()
      }
    }
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${docId}|`)) this.entries.delete(key)
    }
  }
}

export const pageTexts = new PageTextStore(
  (docId, page, signal) => engine.pageText(docId, page, signal),
  120
)
