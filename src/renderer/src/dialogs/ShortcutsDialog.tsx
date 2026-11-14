import { Fragment } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { showShortcuts, useDialogs } from '@/state/dialogs'
import { SHORTCUT_GROUPS } from '@/shell/shortcutReference'

function Keys({ combo }: { combo: string }): React.JSX.Element {
  // "Ctrl++" is Ctrl and "+"; split only on a "+" that follows a modifier.
  const parts = combo
    .match(/^(Ctrl\+)?(Shift\+)?(.+)$/)
    ?.slice(1)
    .filter(Boolean) ?? [combo]
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((part, index) => (
        <kbd
          key={index}
          className="rounded border border-border bg-muted px-1.5 py-px font-sans text-[11px] leading-4 text-foreground"
        >
          {/^(Ctrl|Shift)\+$/.test(part) ? part.slice(0, -1) : part}
        </kbd>
      ))}
    </span>
  )
}

export function ShortcutsDialog(): React.JSX.Element {
  const open = useDialogs((state) => state.shortcutsOpen)
  return (
    <Dialog open={open} onOpenChange={showShortcuts}>
      <DialogContent className="grid max-h-[85vh] grid-rows-[auto_1fr_auto] gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single-letter keys work while no text box has the cursor.
          </DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 overflow-y-auto rounded-sm pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          tabIndex={0}
          role="region"
          aria-label="Shortcut list"
        >
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.title}
                </h3>
                <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[13px]">
                  {group.entries.map((entry) => (
                    <Fragment key={`${entry.action}-${entry.keys.join()}`}>
                      <dt>{entry.action}</dt>
                      <dd className="flex flex-wrap items-center justify-end gap-1">
                        {entry.keys.map((combo, index) => (
                          <Fragment key={combo}>
                            {index > 0 && (
                              <span className="text-[11px] text-muted-foreground">or</span>
                            )}
                            <Keys combo={combo} />
                          </Fragment>
                        ))}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" size="sm" onClick={() => showShortcuts(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
