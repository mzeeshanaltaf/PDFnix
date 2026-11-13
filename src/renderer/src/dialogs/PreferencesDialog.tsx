import { useState } from 'react'
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
import { showPreferences, useDialogs } from '@/state/dialogs'
import { useSettings } from '@/state/settings'
import { PALETTE } from '@/state/tools'

function PreferencesForm(): React.JSX.Element {
  const saved = useSettings()
  const [author, setAuthor] = useState(saved.authorName)
  const [color, setColor] = useState(saved.highlightColor)

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        void saved.update({ authorName: author, highlightColor: color })
        showPreferences(false)
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-base">Preferences</DialogTitle>
        <DialogDescription>How your comments and highlights are made.</DialogDescription>
      </DialogHeader>
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
              className="size-7 rounded-full ring-1 ring-black/15 outline-offset-2 aria-pressed:outline-2 aria-pressed:outline-primary"
              style={{ background: swatch.value }}
            />
          ))}
        </div>
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={() => showPreferences(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
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
      <DialogContent className="sm:max-w-md">{open && <PreferencesForm />}</DialogContent>
    </Dialog>
  )
}
