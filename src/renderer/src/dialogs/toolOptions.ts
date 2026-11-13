/** Option logic shared by the Watermark and Header and Footer dialogs. */

import { useEffect, useState } from 'react'
import { isAbortError } from '@/api/engine'
import { parsePageRanges } from '@/lib/pageRanges'
import type { DocumentTab } from '@/state/tabs'

export type PageScope = 'all' | 'current' | 'range'

export interface PagesChoice {
  scope: PageScope
  range: string
}

/** The pages chosen: undefined for all, a list, or an error. */
export function chosenPages(
  choice: PagesChoice,
  tab: DocumentTab
): { ok: true; pages: number[] | undefined } | { ok: false; error: string } {
  if (choice.scope === 'all') return { ok: true, pages: undefined }
  if (choice.scope === 'current') return { ok: true, pages: [tab.page] }
  const parsed = parsePageRanges(choice.range, tab.pageCount)
  return parsed.ok ? { ok: true, pages: parsed.pages } : parsed
}

/** Longest side of the preview, CSS pixels. */
const PREVIEW_BOX = { width: 300, height: 400 }

/**
 * The current page with the settings applied, rendered by the engine on a
 * throwaway copy. Re-rendered (after a short pause) whenever `key` changes.
 */
export function usePreview(
  tab: DocumentTab,
  key: string,
  enabled: boolean,
  fetch: (scale: number, signal: AbortSignal) => Promise<Blob>
): { url: string | null; error: string | null; width: number; height: number } {
  const page = tab.pages[tab.page]
  const fitScale = Math.min(PREVIEW_BOX.width / page.width, PREVIEW_BOX.height / page.height)
  const width = Math.round(page.width * fitScale)
  const height = Math.round(page.height * fitScale)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      // Image pixels per point: one per device pixel of the preview box.
      const scale = fitScale * (window.devicePixelRatio || 1)
      fetch(Math.min(scale, 4), controller.signal)
        .then((blob) => {
          setError(null)
          setUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous)
            return URL.createObjectURL(blob)
          })
        })
        .catch((caught: unknown) => {
          if (!isAbortError(caught))
            setError(caught instanceof Error ? caught.message : String(caught))
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // `fetch` is rebuilt every render; `key` says when its inputs changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, tab.docId, tab.page, tab.revision])

  useEffect(
    () => () => {
      setUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return null
      })
    },
    []
  )

  return { url, error, width, height }
}
