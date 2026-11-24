import { useEffect, useState } from 'react'
import { cn } from 'cn'
import { Languages, LoaderCircle, PlugZap } from 'lucide-react'
import {
  AI_MAX_CONTEXT_CHOICES,
  DEFAULT_AI_SERVER_URL,
  normalizeServerUrl,
  type AiContextMode,
  type AiServerInfo
} from '../../../shared/ai'
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
import { connectionSummary, modelOptionLabel, shortTokens } from './aiSettings'
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

interface AiChoices {
  url: string
  model: string | null
  context: AiContextMode
  maxContext: number
}

/** The "AI assistant (LM Studio)" section: server address, test, model and context. */
function AiSection({
  value,
  onChange
}: {
  value: AiChoices
  onChange: (patch: Partial<AiChoices>) => void
}): React.JSX.Element {
  // The first test runs with the saved address as the dialog opens, to fill
  // the model list.
  const [testing, setTesting] = useState(true)
  const [info, setInfo] = useState<AiServerInfo | null>(null)
  const urlOk = normalizeServerUrl(value.url) !== null

  useEffect(() => {
    let live = true
    void window.api.ai.listModels().then((result) => {
      if (!live) return
      setInfo(result)
      setTesting(false)
    })
    return () => {
      live = false
    }
  }, [])

  const test = async (): Promise<void> => {
    const url = normalizeServerUrl(value.url)
    if (!url) return
    setTesting(true)
    // Main only ever talks to the saved address, so testing saves it.
    if (url !== useSettings.getState().aiServerUrl) {
      await useSettings.getState().update({ aiServerUrl: url })
    }
    setInfo(await window.api.ai.listModels())
    setTesting(false)
  }

  const models = info?.models ?? []
  const listed = value.model === null || models.some((model) => model.key === value.model)

  return (
    <Section title="AI assistant (LM Studio)">
      <div className="grid gap-1.5">
        <label htmlFor="pref-ai-url" className="text-[13px] font-medium">
          Server address
        </label>
        <div className="flex gap-2">
          <Input
            id="pref-ai-url"
            value={value.url}
            spellCheck={false}
            onChange={(event) => onChange({ url: event.target.value })}
            className="h-8 select-text"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={value.url === DEFAULT_AI_SERVER_URL}
            onClick={() => onChange({ url: DEFAULT_AI_SERVER_URL })}
          >
            Reset
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!urlOk || testing}
            onClick={() => void test()}
          >
            {testing ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <PlugZap aria-hidden />
            )}
            Test connection
          </Button>
        </div>
        {!urlOk ? (
          <p className="text-xs text-destructive">
            Enter an address starting with http:// or https://, such as {DEFAULT_AI_SERVER_URL}.
          </p>
        ) : (
          <p
            role="status"
            className={cn('text-xs', info?.error ? 'text-destructive' : 'text-muted-foreground')}
          >
            {testing ? 'Asking LM Studio…' : info ? connectionSummary(info) : ''}
          </p>
        )}
      </div>

      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        Model
        <select
          className={cn(SELECT, 'max-w-80')}
          value={value.model ?? ''}
          onChange={(event) => onChange({ model: event.target.value || null })}
        >
          <option value="">Automatic (a loaded model first)</option>
          {models.map((model) => (
            <option key={model.key} value={model.key}>
              {modelOptionLabel(model)}
            </option>
          ))}
          {!listed && value.model !== null && (
            <option value={value.model}>
              {value.model}
              {info?.reachable && !info.error ? ' (not in LM Studio)' : ''}
            </option>
          )}
        </select>
      </label>

      <div
        role="radiogroup"
        aria-label="Context sent to the model"
        className="flex flex-wrap items-center gap-4 text-[13px]"
      >
        <span>Context sent to the model:</span>
        {AI_CONTEXTS.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="settings-ai-context"
              checked={value.context === option.value}
              onChange={() => onChange({ context: option.value })}
            />
            {option.label}
          </label>
        ))}
      </div>

      <div className="grid gap-1">
        <label className="flex items-center gap-2 text-[13px]">
          Largest context
          <select
            className={SELECT}
            value={value.maxContext}
            onChange={(event) => onChange({ maxContext: Number(event.target.value) })}
          >
            {maxContextChoices(value.maxContext).map((tokens) => (
              <option key={tokens} value={tokens}>
                {shortTokens(tokens)} tokens
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Larger lets more of a long document in, but uses more memory and makes LM Studio reload
          the model.
        </p>
      </div>
    </Section>
  )
}

const AI_CONTEXTS: { value: AiContextMode; label: string }[] = [
  { value: 'page', label: 'This page' },
  { value: 'document', label: 'Whole document' }
]

/** The offered sizes, plus the saved one if it is not among them. */
function maxContextChoices(current: number): number[] {
  const choices: number[] = [...AI_MAX_CONTEXT_CHOICES]
  return choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b)
}

function SettingsForm(): React.JSX.Element {
  const saved = useSettings()
  const [theme, setTheme] = useState(saved.theme)
  const [zoom, setZoom] = useState(saved.defaultZoom)
  const [layout, setLayout] = useState(saved.defaultLayout)
  const [author, setAuthor] = useState(saved.authorName)
  const [color, setColor] = useState(saved.highlightColor)
  const [ocr, setOcr] = useState(saved.ocrLanguages)
  const [minutes, setMinutes] = useState(String(saved.recoveryMinutes))
  const [scanCodes, setScanCodes] = useState(saved.scanCodes)
  const [ai, setAi] = useState<AiChoices>({
    url: saved.aiServerUrl,
    model: saved.aiModel,
    context: saved.aiContext,
    maxContext: saved.aiMaxContext
  })
  const { languages, error: languageError } = useInstalledLanguages()
  const aiUrl = normalizeServerUrl(ai.url)

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
        if (!minutesOk || chosenOcr.length === 0 || !aiUrl) return
        if (theme !== saved.theme) void saved.setTheme(theme)
        void saved.update({
          authorName: author,
          highlightColor: color,
          defaultZoom: zoom,
          defaultLayout: layout,
          ocrLanguages: chosenOcr,
          recoveryMinutes: minutesValue,
          scanCodes,
          aiServerUrl: aiUrl,
          aiModel: ai.model,
          aiContext: ai.context,
          aiMaxContext: ai.maxContext
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

        <Section title="QR codes and barcodes">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={scanCodes}
              onChange={(event) => setScanCodes(event.target.checked)}
            />
            Look for codes automatically when a document opens
          </label>
          <p className="text-xs text-muted-foreground">
            When this is off, documents are only searched for codes when you open the Codes panel or
            Tools → QR Codes and Barcodes.
          </p>
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

        <AiSection
          value={ai}
          onChange={(patch) => setAi((current) => ({ ...current, ...patch }))}
        />

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
        <Button type="submit" size="sm" disabled={!minutesOk || chosenOcr.length === 0 || !aiUrl}>
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
