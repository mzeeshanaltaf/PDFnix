/**
 * Per-page data fetched from the engine for the pages on screen: the words of
 * the text layer, the annotations. Cached by document, page and the page's
 * revision (so a changed page fetches afresh), least recently used first out.
 */

import {
  engine,
  isAbortError,
  type Annotation,
  type PageBlocks,
  type PageLinks,
  type PageText
} from '@/api/engine'

export type PageFetcher<T> = (docId: string, page: number, signal: AbortSignal) => Promise<T>

interface Pending {
  waiters: number
  controller: AbortController
}

function keyOf(docId: string, page: number, revision: number): string {
  return `${docId}|${page}|${revision}`
}

export class PageDataStore<T> {
  /** In least-recently-used order. */
  private readonly entries = new Map<string, T>()
  private readonly pending = new Map<string, Pending>()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly fetcher: PageFetcher<T>,
    private readonly maxPages: number,
    private readonly what = 'page data'
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

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  peek(docId: string, page: number, revision: number): T | null {
    return this.entries.get(keyOf(docId, page, revision)) ?? null
  }

  /** Puts a value in the cache that is already known (for example from a mutation). */
  put(docId: string, page: number, revision: number, value: T): void {
    const key = keyOf(docId, page, revision)
    this.entries.delete(key)
    this.entries.set(key, value)
    this.trim()
    this.notify()
  }

  private trim(): void {
    while (this.entries.size > this.maxPages) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  /**
   * A page's data, from the cache or fetched now (and then cached). For a
   * one-off need outside a component; components use `request` through the
   * hooks so leaving pages can withdraw theirs.
   */
  async load(docId: string, page: number, revision: number): Promise<T> {
    const cached = this.peek(docId, page, revision)
    if (cached) return cached
    const value = await this.fetcher(docId, page, new AbortController().signal)
    this.put(docId, page, revision, value)
    return value
  }

  /** Loads a page's data unless it is cached. Returns a function that withdraws the request. */
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
        .then((value) => {
          if (this.pending.get(key) !== started) return
          this.pending.delete(key)
          this.entries.set(key, value)
          this.trim()
          this.notify()
        })
        .catch((error: unknown) => {
          if (this.pending.get(key) === started) this.pending.delete(key)
          if (!isAbortError(error)) console.warn(`Could not load ${this.what}`, error)
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

export const pageTexts = new PageDataStore<PageText>(
  (docId, page, signal) => engine.pageText(docId, page, signal),
  120,
  'page text'
)

export const pageLinks = new PageDataStore<PageLinks>(
  (docId, page, signal) => engine.pageLinks(docId, page, signal),
  120,
  'links'
)

export const pageBlocks = new PageDataStore<PageBlocks>(
  (docId, page, signal) => engine.pageBlocks(docId, page, signal),
  40,
  'text blocks'
)

export const pageAnnotations = new PageDataStore<Annotation[]>(
  (docId, page, signal) => engine.annotations(docId, page, signal),
  200,
  'annotations'
)
