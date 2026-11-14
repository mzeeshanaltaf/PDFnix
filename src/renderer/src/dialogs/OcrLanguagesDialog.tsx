import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { engine, type OcrLanguage } from '@/api/engine'
import { showOcrLanguages, useDialogs } from '@/state/dialogs'
import { downloadLanguage } from '@/state/processing'

function sizeText(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

function LanguageList(): React.JSX.Element {
  const [languages, setLanguages] = useState<OcrLanguage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    engine
      .ocrLanguages()
      .then((all) => {
        setLanguages(all)
        setError(null)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught))
      )
  }, [])
  useEffect(load, [load])

  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const all = languages ?? []
    const matching = query
      ? all.filter(
          (language) => language.name.toLowerCase().includes(query) || language.code.includes(query)
        )
      : all
    // Installed first, then by name.
    return [...matching].sort(
      (a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name)
    )
  }, [languages, filter])

  const download = async (language: OcrLanguage): Promise<void> => {
    setBusy(language.code)
    try {
      if (await downloadLanguage(language.code, language.name)) {
        toast.success(`${language.name} can now be used for text recognition`)
      }
    } finally {
      setBusy(null)
      load()
    }
  }

  const remove = async (language: OcrLanguage): Promise<void> => {
    setBusy(language.code)
    try {
      await engine.removeOcrLanguage(language.code)
    } catch (caught) {
      toast.error(`Could not remove ${language.name}`, {
        description: caught instanceof Error ? caught.message : String(caught)
      })
    } finally {
      setBusy(null)
      load()
    }
  }

  return (
    <div className="grid gap-3">
      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Find a language"
        aria-label="Find a language"
        className="h-8 select-text"
        autoFocus
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <ul
        className="h-80 overflow-auto rounded-md border text-[13px]"
        aria-label="OCR languages"
        aria-busy={languages === null}
      >
        {languages === null && !error && (
          <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li>
        )}
        {shown.map((language) => (
          <li
            key={language.code}
            className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate">
              {language.name}
              <span className="ml-1.5 text-xs text-muted-foreground">{language.code}</span>
            </span>
            {language.bundled ? (
              <span className="text-xs text-muted-foreground">Included</span>
            ) : language.installed ? (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy !== null}
                onClick={() => void remove(language)}
                aria-label={`Remove ${language.name}`}
              >
                <Trash2 aria-hidden /> Remove
              </Button>
            ) : (
              <Button
                variant="outline"
                size="xs"
                disabled={busy !== null}
                onClick={() => void download(language)}
                aria-label={`Download ${language.name} (${sizeText(language.sizeKb)})`}
              >
                <Download aria-hidden /> {sizeText(language.sizeKb)}
              </Button>
            )}
          </li>
        ))}
        {languages !== null && shown.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">No language matches.</li>
        )}
      </ul>
    </div>
  )
}

export function OcrLanguagesDialog(): React.JSX.Element {
  const open = useDialogs((state) => state.ocrLanguagesOpen)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && showOcrLanguages(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">OCR Languages</DialogTitle>
          <DialogDescription>
            English is included. Other languages are downloaded once from the Tesseract project
            (tessdata_fast) and kept on this computer.
          </DialogDescription>
        </DialogHeader>
        {open && <LanguageList />}
        <DialogFooter>
          <Button size="sm" onClick={() => showOcrLanguages(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
