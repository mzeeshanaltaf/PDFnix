/**
 * Pieces shared by the Watermark and Header and Footer dialogs: which pages,
 * colour choice, and the live preview of the current page.
 */

import { Input } from '@/components/ui/input'
import type { DocumentTab } from '@/state/tabs'
import { chosenPages, type PagesChoice } from './toolOptions'

export function PagesPicker({
  value,
  onChange,
  tab,
  name
}: {
  value: PagesChoice
  onChange: (value: PagesChoice) => void
  tab: DocumentTab
  name: string
}): React.JSX.Element {
  const result = chosenPages(value, tab)
  return (
    <fieldset className="grid gap-1.5 text-xs">
      <legend className="mb-1 text-[13px] font-medium">Pages</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={name}
            checked={value.scope === 'all'}
            onChange={() => onChange({ ...value, scope: 'all' })}
          />
          All {tab.pageCount}
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={name}
            checked={value.scope === 'current'}
            onChange={() => onChange({ ...value, scope: 'current' })}
          />
          This page ({tab.page + 1})
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name={name}
            checked={value.scope === 'range'}
            onChange={() => onChange({ ...value, scope: 'range' })}
          />
          <Input
            value={value.range}
            placeholder="1-3, 7, 10-"
            onChange={(event) => onChange({ scope: 'range', range: event.target.value })}
            className="h-6 w-28 select-text text-xs"
            aria-label="Page range"
          />
        </label>
      </div>
      {!result.ok && value.range.trim() !== '' && (
        <p className="text-destructive">{result.error}</p>
      )}
    </fieldset>
  )
}

const COLORS = ['#000000', '#7f7f7f', '#d32f2f', '#1565c0', '#2e7d32', '#ef6c00']

export function ColorPicker({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (value: string) => void
  label: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={value.toLowerCase() === color}
          onClick={() => onChange(color)}
          className="size-5 rounded-full ring-1 ring-black/20 outline-offset-2 aria-pressed:outline-2 aria-pressed:outline-primary"
          style={{ background: color }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${label}: other colour`}
        className="h-5 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
      />
    </div>
  )
}

export function PreviewPane({
  url,
  error,
  width,
  height,
  page
}: {
  url: string | null
  error: string | null
  width: number
  height: number
  page: number
}): React.JSX.Element {
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <div
        className="flex items-center justify-center overflow-hidden rounded-xs bg-white shadow-sm ring-1 ring-black/10"
        style={{ width, height }}
      >
        {url ? (
          <img
            src={url}
            alt={`Preview of page ${page + 1}`}
            className="size-full"
            draggable={false}
          />
        ) : (
          <span className="px-4 text-center text-xs text-neutral-500">{error ?? 'Preview…'}</span>
        )}
      </div>
      <figcaption className="text-[11px] text-muted-foreground">
        Preview of page {page + 1}
      </figcaption>
    </figure>
  )
}
