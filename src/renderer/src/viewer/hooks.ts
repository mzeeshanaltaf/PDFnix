import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Annotation, PageText } from '@/api/engine'
import { pageImages, type PageImage } from './pageImages'
import { pageAnnotations, pageTexts, type PageDataStore } from './pageText'

/** `value`, but only once it has stopped changing for `delay` milliseconds. */
export function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

function subscribeToResize(listener: () => void): () => void {
  // The pixel ratio changes with the display the window is on and with the
  // system's scaling; both resize the window's viewport.
  window.addEventListener('resize', listener)
  return () => window.removeEventListener('resize', listener)
}

export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribeToResize, () => window.devicePixelRatio || 1)
}

export interface PageImageResult {
  /** The best image available: at the wanted scale, or another one meanwhile. */
  image: PageImage | null
  /** True if loading the image at the wanted scale failed. */
  failed: boolean
  retry: () => void
}

/**
 * The image of a page at `scale` image pixels per point. Requests it if
 * needed and keeps it cached while the calling component is mounted.
 * Pass `scale` 0 to request nothing.
 */
export function usePageImage(
  docId: string,
  page: number,
  revision: number,
  scale: number,
  priority: number
): PageImageResult {
  const [attempt, setAttempt] = useState(0)
  const image = useSyncExternalStore(pageImages.subscribe, () =>
    scale > 0 ? pageImages.peek(docId, page, revision, scale) : null
  )
  const failed = useSyncExternalStore(pageImages.subscribe, () =>
    scale > 0 ? pageImages.hasFailed(docId, page, revision, scale) : false
  )

  useEffect(() => {
    if (scale <= 0) return
    return pageImages.request({ docId, page, revision, scale }, priority)
  }, [docId, page, revision, scale, priority, attempt])

  return { image, failed, retry: () => setAttempt((count) => count + 1) }
}

/** How long a page must stay mounted before its text is fetched. */
const TEXT_DELAY_MS = 120

function usePageData<T>(
  store: PageDataStore<T>,
  docId: string,
  page: number,
  revision: number,
  enabled: boolean
): T | null {
  const value = useSyncExternalStore(store.subscribe, () => store.peek(docId, page, revision))

  useEffect(() => {
    if (!enabled) return
    // Pages that only fly past while scrolling never ask.
    let release = (): void => {}
    const timer = setTimeout(() => {
      release = store.request(docId, page, revision)
    }, TEXT_DELAY_MS)
    return () => {
      clearTimeout(timer)
      release()
    }
  }, [store, docId, page, revision, enabled])

  return value
}

/** The words of a page, or `null` while they are not loaded. */
export function usePageText(
  docId: string,
  page: number,
  revision: number,
  enabled: boolean
): PageText | null {
  return usePageData(pageTexts, docId, page, revision, enabled)
}

/** The annotations of a page, or `null` while they are not loaded. */
export function usePageAnnotations(
  docId: string,
  page: number,
  revision: number,
  enabled: boolean
): Annotation[] | null {
  return usePageData(pageAnnotations, docId, page, revision, enabled)
}
