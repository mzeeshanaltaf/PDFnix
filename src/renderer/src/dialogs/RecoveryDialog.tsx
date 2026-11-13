import { useState } from 'react'
import { FileWarning, Lock } from 'lucide-react'
import type { RecoveryEntry } from '@/api/engine'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useDialogs } from '@/state/dialogs'
import { discardRecovery, restoreRecovery } from '@/state/documents'

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function remove(entry: RecoveryEntry): void {
  useDialogs.setState((state) => ({
    recovery: state.recovery.filter((item) => item.recoveryId !== entry.recoveryId)
  }))
}

/**
 * Offered at start-up when documents had unsaved changes the last time the
 * app (or its window) stopped. Each can be restored, with its changes still
 * unsaved, or discarded. Closing the dialog keeps them for next time.
 */
export function RecoveryDialog(): React.JSX.Element {
  const entries = useDialogs((state) => state.recovery)
  const [busy, setBusy] = useState<string | null>(null)

  const restore = async (entry: RecoveryEntry): Promise<void> => {
    setBusy(entry.recoveryId)
    try {
      if (await restoreRecovery(entry)) remove(entry)
    } finally {
      setBusy(null)
    }
  }

  const discard = async (entry: RecoveryEntry): Promise<void> => {
    setBusy(entry.recoveryId)
    try {
      await discardRecovery(entry)
      remove(entry)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={entries.length > 0}
      onOpenChange={(open) => {
        if (!open) useDialogs.setState({ recovery: [] })
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileWarning className="size-4 text-status-busy" aria-hidden />
            Recover unsaved changes
          </DialogTitle>
          <DialogDescription>
            These documents had unsaved changes when PDFnix last stopped. Restore them to keep
            working, then save.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid max-h-72 min-w-0 grid-cols-1 gap-2 overflow-y-auto">
          {entries.map((entry) => (
            <li
              key={entry.recoveryId}
              className="flex min-w-0 items-center gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {entry.isEncrypted && (
                    <Lock
                      className="size-3.5 shrink-0 opacity-70"
                      aria-label="Password protected"
                    />
                  )}
                  <span className="truncate">{entry.fileName}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground" title={entry.originalPath}>
                  {formatDate(entry.writtenAt)} · {entry.originalPath}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void discard(entry)}
              >
                Discard
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => void restore(entry)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => useDialogs.setState({ recovery: [] })}
          >
            Decide later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
