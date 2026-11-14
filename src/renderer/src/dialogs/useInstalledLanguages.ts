import { useCallback, useEffect, useState } from 'react'
import { engine, type OcrLanguage } from '@/api/engine'
import { useDialogs } from '@/state/dialogs'

/** Installed OCR languages, refreshed whenever the languages dialog closes. */
export function useInstalledLanguages(): {
  languages: OcrLanguage[] | null
  error: string | null
} {
  const managing = useDialogs((state) => state.ocrLanguagesOpen)
  const [languages, setLanguages] = useState<OcrLanguage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    engine
      .ocrLanguages()
      .then((all) => {
        setLanguages(all.filter((language) => language.installed))
        setError(null)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught))
      )
  }, [])
  useEffect(() => {
    if (!managing) load()
  }, [managing, load])
  return { languages, error }
}
