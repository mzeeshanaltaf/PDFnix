import { useState } from 'react'
import { Languages } from 'lucide-react'
import {
  MAX_OCR_LANGUAGES,
  RECOVERY_MINUTES,
  type DefaultZoom,
  type LayoutMode,
  type ThemeSource
} from '../../../shared/api'
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
import { showOcrLanguages, showPreferences, useDialogs } from '@/state/dialogs'
import { useSettings } from '@/state/settings'
import { PALETTE } from '@/state/tools'
import { useInstalledLanguages } from './useInstalledLanguages'

const THEMES: { value: ThemeSource; label: string }[] = [
  { value: 'system', label: 'Same as Windows' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const ZOOMS: { value: DefaultZoom; label: string }[] = [
  { value: 'actual-size', label: '100 %' },
  { value: 'fit-width', label: 'Fit width' },
  { value: 'fit-page', label: 'Fit page' }
]

const LAYOUTS: { value: LayoutMode; label: string }[] = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'single', label: 'Single page' },
  { value: 'two-page', label: 'Two pages' }
]

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section aria-label={title} className="grid gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

const SELECT = 'h-8 rounded-md border bg-background px-2 text-[13px]'

function SettingsForm(): React.JSX.Element {
  const saved = useSettings()
  const [theme, setTheme] = useState(saved.theme)
  const [zoom, setZoom] = useState(saved.defaultZoom)
  const [layout, setLayout] = useState(saved.defaultLayout)
  const [author, setAuthor] = useState(saved.authorName)
  const [color, setColor] = useState(saved.highlightColor)
  const [ocr, setOcr] = useState(saved.ocrLanguages)
  const [minutes, setMinutes] = useState(String(saved.recoveryMinutes))
  const { languages, error: languageError } = useInstalledLanguages()

  const minutesValue = Number(minutes)
  const minutesOk =
    Number.isInteger(minutesValue) &&
    minutesValue >= RECOVERY_MINUTES.min &&
    minutesValue <= RECOVERY_MINUTES.max
  const installed = new Set((languages ?? []).map((language) => language.code))
  const chosenOcr = languages === null ? ocr : ocr.filter((code) => installed.has(code))

  const toggleLanguage = (code: string): void => {
    setOcr((current) =>
      current.includes(code)
        ? current.filter((entry) => entry !== code)
        : current.length < MAX_OCR_LANGUAGES
          ? [...current, code]
          : current
    )
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!minutesOk || chosenOcr.length === 0) return
        if (theme !== saved.theme) void saved.setTheme(theme)
        void saved.update({
          authorName: author,
          highlightColor: color,
          defaultZoom: zoom,
          defaultLayout: layout,
          ocrLanguages: chosenOcr,
          recoveryMinutes: minutesValue
        })
        showPreferences(false)
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Settings</DialogTitle>
        <DialogDescription>Saved for you on this computer.</DialogDescription>
      </DialogHeader>

      <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
        <Section title="Appearance">
          <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-4 text-[13px]">
            {THEMES.map((option) => (
              <label key={option.value} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="settings-theme"
                  checked={theme === option.value}
                  onChange={() => setTheme(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Opening documents">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            <label className="flex items-center gap-2">
              Zoom
              <select
                className={SELECT}
                value={zoom}
                onChange={(event) => setZoom(event.target.value as DefaultZoom)}
              >
                {ZOOMS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Page layout
              <select
                className={SELECT}
                value={layout}
                onChange={(event) => setLayout(event.target.value as LayoutMode)}
              >
                {LAYOUTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Section>

        <Section title="Comments">
          <div className="grid gap-1.5">
            <label htmlFor="pref-author" className="text-[13px] font-medium">
              Author name
            </label>
            <Input
              id="pref-author"
              value={author}
              maxLength={100}
              onChange={(event) => setAuthor(event.target.value)}
              className="select-text"
            />
            <p className="text-xs text-muted-foreground">
              Stored with each comment you add. Leave empty to use your Windows user name.
            </p>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium">Default highlight colour</legend>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((swatch) => (
                <button
                  key={swatch.value}
                  type="button"
                  title={swatch.label}
                  aria-label={swatch.label}
                  aria-pressed={color === swatch.value}
                  onClick={() => setColor(swatch.value)}
                  className="size-7 rounded-full ring-1 ring-black/15 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:outline-2 aria-pressed:outline-primary"
                  style={{ background: swatch.value }}
                />
              ))}
            </div>
          </fieldset>
        </Section>

        <Section title="Text recognition (OCR)">
          <p className="text-xs text-muted-foreground">
            Languages the Recognise Text dialog starts with (up to {MAX_OCR_LANGUAGES}).
          </p>
          <div
            role="group"
            aria-label="OCR languages"
            className="flex flex-wrap items-center gap-1.5"
          >
            {languages === null && !languageError && (
              <span className="text-xs text-muted-foreground">Loading languages…</span>
            )}
            {languageError && (
              <span className="text-xs text-destructive">
                The installed languages could not be read: {languageError}
              </span>
            )}
            {(languages ?? []).map((language) => (
              <button
                key={language.code}
                type="button"
                aria-pressed={chosenOcr.includes(language.code)}
                onClick={() => toggleLanguage(language.code)}
                className="rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {language.name}
              </button>
            ))}
            <Button type="button" variant="ghost" size="xs" onClick={() => showOcrLanguages(true)}>
              <Languages aria-hidden /> More languages…
            </Button>
          </div>
          {languages !== null && chosenOcr.length === 0 && (
            <p className="text-xs text-destructive">Choose at least one language.</p>
          )}
        </Section>

        <Section title="Recovery">
          <label className="flex flex-wrap items-center gap-2 text-[13px]">
            Keep a recovery copy of unsaved changes after
            <Input
              type="number"
              aria-label="Minutes before a recovery copy"
              min={RECOVERY_MINUTES.min}
              max={RECOVERY_MINUTES.max}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="h-8 w-16 select-text"
            />
            minutes
          </label>
          {!minutesOk && (
            <p className="text-xs text-destructive">
              Enter whole minutes from {RECOVERY_MINUTES.min} to {RECOVERY_MINUTES.max}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            If PDFnix closes unexpectedly, the copy is offered when it next starts.
          </p>
        </Section>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => showPreferences(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!minutesOk || chosenOcr.length === 0}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}

export function PreferencesDialog(): React.JSX.Element {
  const open = useDialogs((state) => state.preferencesOpen)
  return (
    <Dialog open={open} onOpenChange={showPreferences}>
      <DialogContent className="sm:max-w-lg">{open && <SettingsForm />}</DialogContent>
    </Dialog>
  )
}
