import { useState } from 'react'
import { Languages } from 'lucide-react'
import { MAX_OCR_LANGUAGES } from '../../../shared/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { showOcrLanguages, showToolDialog, useDialogs } from '@/state/dialogs'
import { recogniseText } from '@/state/processing'
import { useSettings } from '@/state/settings'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { PagesPicker } from './toolParts'
import { chosenPages, type PagesChoice } from './toolOptions'
import { useInstalledLanguages } from './useInstalledLanguages'

/** At most this many languages in one run (each one slows recognition down). */
const MAX_LANGUAGES = MAX_OCR_LANGUAGES
const RESOLUTIONS = [150, 200, 300, 400, 600]

function OcrForm({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const { languages, error: languageError } = useInstalledLanguages()
  const [pages, setPages] = useState<PagesChoice>({ scope: 'all', range: '' })
  // Starts with the languages chosen in Settings.
  const [selected, setSelected] = useState<string[]>(() => useSettings.getState().ocrLanguages)
  const [dpi, setDpi] = useState(300)
  const [skipText, setSkipText] = useState(true)

  // Languages removed meanwhile drop out of the choice.
  const available = new Set((languages ?? []).map((language) => language.code))
  const chosen = languages === null ? selected : selected.filter((code) => available.has(code))
  const pageChoice = chosenPages(pages, tab)
  const close = (): void => showToolDialog('ocrTabId', null)

  const toggle = (code: string): void => {
    if (chosen.includes(code)) setSelected(chosen.filter((item) => item !== code))
    else if (chosen.length < MAX_LANGUAGES) setSelected([...chosen, code])
  }

  const run = (): void => {
    if (!pageChoice.ok || chosen.length === 0) return
    close()
    void recogniseText(tab.id, {
      ...(pageChoice.pages ? { pages: pageChoice.pages } : {}),
      languages: chosen,
      dpi,
      skipPagesWithText: skipText
    })
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        run()
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Recognise Text (OCR)</DialogTitle>
        <DialogDescription>
          Finds the text in scanned pages and adds it invisibly, so it can be searched, selected and
          copied. The pages look exactly as before.
        </DialogDescription>
      </DialogHeader>

      <PagesPicker value={pages} onChange={setPages} tab={tab} name="ocr-pages" />

      <fieldset className="grid gap-1.5 text-xs">
        <legend className="mb-1 text-[13px] font-medium">Language of the text</legend>
        {languageError && <p className="text-destructive">{languageError}</p>}
        <div className="flex flex-wrap gap-1.5">
          {(languages ?? []).map((language) => (
            <button
              key={language.code}
              type="button"
              aria-pressed={chosen.includes(language.code)}
              onClick={() => toggle(language.code)}
              className="rounded-full border px-2.5 py-1 text-xs aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {language.name}
            </button>
          ))}
          <Button type="button" variant="ghost" size="xs" onClick={() => showOcrLanguages(true)}>
            <Languages aria-hidden /> More languages…
          </Button>
        </div>
        <p className="text-muted-foreground">
          {chosen.length === 0
            ? 'Choose at least one language.'
            : `Up to ${MAX_LANGUAGES} languages can be combined; each one makes recognition slower.`}
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        <label className="flex items-center gap-2">
          Resolution
          <select
            value={dpi}
            onChange={(event) => setDpi(Number(event.target.value))}
            className="h-7 rounded-md border bg-background px-2 text-xs"
          >
            {RESOLUTIONS.map((value) => (
              <option key={value} value={value}>
                {value} dpi{value === 300 ? ' (recommended)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={skipText}
            onChange={(event) => setSkipText(event.target.checked)}
          />
          Skip pages that already have text
        </label>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Results depend on the scan: clear, straight pages at 300 dpi recognise best; faint, skewed
        or handwritten pages may give poor text. Recognition takes a few seconds per page and can be
        cancelled; undo removes the recognised text.
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!pageChoice.ok || chosen.length === 0}>
          Recognise Text
        </Button>
      </DialogFooter>
    </form>
  )
}

export function OcrDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.ocrTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog open={tab !== null} onOpenChange={(open) => !open && showToolDialog('ocrTabId', null)}>
      <DialogContent className="sm:max-w-lg">
        {tab && <OcrForm key={tab.id} tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
