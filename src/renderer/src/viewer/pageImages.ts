/**
 * Page images: fetching, caching and sharing them between components.
 *
 * - Images are keyed by document, page, page revision and scale.
 * - The cache is bounded by the total size of the images it holds. Images a
 *   mounted component is showing are pinned and never evicted.
 * - Requests are queued and only a few run at a time, most urgent and most
 *   recent first; a request nobody waits for any more is cancelled.
 * - While the image at the wanted scale is loading, `peek` hands out the one
 *   at the nearest other scale, which the page shows stretched.
 */

import { engine, isAbortError } from '@/api/engine'

export interface ImageTarget {
  docId: string
  /** 0-based page index. */
  page: number
  /** The revision that last changed this page. */
  revision: number
  /** Image pixels per point. */
  scale: number
}

export interface PageImage {
  /** An object URL for the image. */
  url: string
  /** The scale the image was rendered at. */
  scale: number
  bytes: number
}

export type ImageFetcher = (target: ImageTarget, signal: AbortSignal) => Promise<Blob>

export interface PageImageStoreOptions {
  /** Upper bound for the total size of cached images. */
  maxBytes: number
  /** Requests running at the same time. */
  concurrency: number
  createUrl?: (blob: Blob) => string
  revokeUrl?: (url: string) => void
}

/** Lower numbers are served first. */
export const IMAGE_PRIORITY = { visible: 0, nearby: 1, thumbnail: 2 } as const

interface Entry {
  key: string
  pageKey: string
  docId: string
  image: PageImage
  /** Mounted components currently showing or wanting this image. */
  pins: number
}

interface Pending {
  key: string
  target: ImageTarget
  priority: number
  /** Position in the order requests were made; later is served first. */
  order: number
  waiters: number
  /** Set once the request is running. */
  controller: AbortController | null
}

function pageKeyOf(docId: string, page: number, revision: number): string {
  return `${docId}|${page}|${revision}`
}

function scaleKey(scale: number): string {
  return scale.toFixed(3)
}

function keyOf(docId: string, page: number, revision: number, scale: number): string {
  return `${pageKeyOf(docId, page, revision)}|${scaleKey(scale)}`
}

export class PageImageStore {
  /** In least-recently-used order: the first entry is the next to go. */
  private readonly entries = new Map<string, Entry>()
  private readonly byPage = new Map<string, Set<Entry>>()
  private readonly pending = new Map<string, Pending>()
  private readonly failed = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly createUrl: (blob: Blob) => string
  private readonly revokeUrl: (url: string) => void
  private running = 0
  private sequence = 0
  private totalBytes = 0

  constructor(
    private readonly fetcher: ImageFetcher,
    private readonly options: PageImageStoreOptions
  ) {
    this.createUrl = options.createUrl ?? ((blob) => URL.createObjectURL(blob))
    this.revokeUrl = options.revokeUrl ?? ((url) => URL.revokeObjectURL(url))
  }

  /** Total size of the cached images. */
  get bytes(): number {
    return this.totalBytes
  }

  /** Number of cached images. */
  get size(): number {
    return this.entries.size
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * The best image available right now for a page: the one at `scale` if it
   * is cached, otherwise the nearest sharper one, otherwise the sharpest
   * blurrier one. Does not start a request.
   */
  peek(docId: string, page: number, revision: number, scale: number): PageImage | null {
    const exact = this.entries.get(keyOf(docId, page, revision, scale))
    if (exact) return exact.image
    const candidates = this.byPage.get(pageKeyOf(docId, page, revision))
    if (!candidates) return null

    let above: Entry | null = null
    let below: Entry | null = null
    for (const entry of candidates) {
      if (entry.image.scale >= scale) {
        if (!above || entry.image.scale < above.image.scale) above = entry
      } else if (!below || entry.image.scale > below.image.scale) {
        below = entry
      }
    }
    return (above ?? below)?.image ?? null
  }

  /** True if the last attempt to load this exact image failed. */
  hasFailed(docId: string, page: number, revision: number, scale: number): boolean {
    return this.failed.has(keyOf(docId, page, revision, scale))
  }

  /**
   * Asks for an image and keeps it in the cache for as long as the caller
   * needs it. Returns a function to call when it is no longer needed.
   */
  request(target: ImageTarget, priority: number): () => void {
    const key = keyOf(target.docId, target.page, target.revision, target.scale)
    const existing = this.entries.get(key)
    if (existing) {
      existing.pins += 1
      // Mark as recently used.
      this.entries.delete(key)
      this.entries.set(key, existing)
    } else {
      this.failed.delete(key)
      let waiting = this.pending.get(key)
      if (!waiting) {
        waiting = { key, target, priority, order: 0, waiters: 0, controller: null }
        this.pending.set(key, waiting)
      }
      waiting.waiters += 1
      waiting.priority = Math.min(waiting.priority, priority)
      waiting.order = ++this.sequence
      this.pump()
    }

    let released = false
    return () => {
      if (released) return
      released = true
      const entry = this.entries.get(key)
      if (entry) {
        entry.pins = Math.max(0, entry.pins - 1)
        if (entry.pins === 0 && this.totalBytes > this.options.maxBytes) this.evict()
        return
      }
      const waiting = this.pending.get(key)
      if (!waiting) return
      waiting.waiters -= 1
      if (waiting.waiters <= 0) {
        this.pending.delete(key)
        waiting.controller?.abort()
      }
    }
  }

  /** Forgets everything cached or queued for a document (it was closed). */
  dropDocument(docId: string): void {
    for (const [key, waiting] of this.pending) {
      if (waiting.target.docId === docId) {
        this.pending.delete(key)
        waiting.controller?.abort()
      }
    }
    let changed = false
    for (const entry of [...this.entries.values()]) {
      if (entry.docId === docId) {
        this.remove(entry)
        changed = true
      }
    }
    for (const key of [...this.failed]) {
      if (key.startsWith(`${docId}|`)) this.failed.delete(key)
    }
    if (changed) this.notify()
  }

  private pump(): void {
    while (this.running < this.options.concurrency) {
      let next: Pending | null = null
      for (const waiting of this.pending.values()) {
        if (waiting.controller) continue
        if (
          !next ||
          waiting.priority < next.priority ||
          (waiting.priority === next.priority && waiting.order > next.order)
        ) {
          next = waiting
        }
      }
      if (!next) return
      void this.run(next)
    }
  }

  private async run(waiting: Pending): Promise<void> {
    const controller = new AbortController()
    waiting.controller = controller
    this.running += 1
    try {
      const blob = await this.fetcher(waiting.target, controller.signal)
      // A request that was withdrawn meanwhile is no longer in `pending`.
      if (this.pending.get(waiting.key) === waiting) {
        this.pending.delete(waiting.key)
        this.store(waiting, blob)
      }
    } catch (error) {
      if (this.pending.get(waiting.key) === waiting) {
        this.pending.delete(waiting.key)
        if (!isAbortError(error)) {
          this.failed.add(waiting.key)
          this.notify()
        }
      }
    } finally {
      this.running -= 1
      this.pump()
    }
  }

  private store(waiting: Pending, blob: Blob): void {
    const { target, key } = waiting
    if (this.entries.has(key)) return
    const entry: Entry = {
      key,
      pageKey: pageKeyOf(target.docId, target.page, target.revision),
      docId: target.docId,
      image: { url: this.createUrl(blob), scale: target.scale, bytes: blob.size },
      pins: Math.max(0, waiting.waiters)
    }
    this.entries.set(key, entry)
    let siblings = this.byPage.get(entry.pageKey)
    if (!siblings) {
      siblings = new Set()
      this.byPage.set(entry.pageKey, siblings)
    }
    siblings.add(entry)
    this.totalBytes += entry.image.bytes
    this.evict()
    this.notify()
  }

  /** Drops the least recently used images nobody is showing until the cache fits. */
  private evict(): void {
    if (this.totalBytes <= this.options.maxBytes) return
    for (const entry of [...this.entries.values()]) {
      if (this.totalBytes <= this.options.maxBytes) break
      if (entry.pins === 0) this.remove(entry)
    }
  }

  private remove(entry: Entry): void {
    this.entries.delete(entry.key)
    const siblings = this.byPage.get(entry.pageKey)
    if (siblings) {
      siblings.delete(entry)
      if (siblings.size === 0) this.byPage.delete(entry.pageKey)
    }
    this.totalBytes -= entry.image.bytes
    this.revokeUrl(entry.image.url)
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/** The app's one image store. 192 MB of encoded images is several hundred pages. */
export const pageImages = new PageImageStore(
  (target, signal) => engine.renderPage(target.docId, target.page, target.scale, { signal }),
  { maxBytes: 192 * 1024 * 1024, concurrency: 2 }
)
