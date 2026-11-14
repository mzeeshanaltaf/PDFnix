/**
 * The progress of a background job: title, progress bar, current step and
 * Cancel. `JobProgressDialog` shows the job started with `runJob`;
 * `JobProgressView` is the same display for use inside another dialog.
 */

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { JobSnapshot } from '@/api/engine'
import { cancelActiveJob, useActiveJob } from '@/state/jobs'

export function ProgressBar({
  value,
  label
}: {
  /** 0..1, or null while nothing is known yet. */
  value: number | null
  label: string
}): React.JSX.Element {
  const percent = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={`h-full rounded-full bg-primary transition-[width] duration-300 ease-out ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  )
}

export function JobProgressView({
  title,
  snapshot,
  cancelling
}: {
  title: string
  snapshot: JobSnapshot | null
  cancelling: boolean
}): React.JSX.Element {
  const started = snapshot !== null && snapshot.status !== 'queued'
  const progress = started ? snapshot.progress : null
  const step = cancelling ? 'Stopping…' : snapshot?.message || (started ? 'Working…' : 'Starting…')
  return (
    <div className="grid gap-2">
      <ProgressBar value={progress} label={title} />
      <div className="flex items-baseline gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" aria-live="polite">
          {step}
        </span>
        {progress !== null && <span className="tabular-nums">{Math.round(progress * 100)} %</span>}
      </div>
    </div>
  )
}

export function JobProgressDialog(): React.JSX.Element {
  const active = useActiveJob((state) => state.active)
  return (
    <Dialog
      open={active !== null}
      onOpenChange={(open) => {
        // Escape asks the job to stop; the dialog closes once it has.
        if (!open) void cancelActiveJob()
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {active && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{active.title}</DialogTitle>
              <DialogDescription className="sr-only">
                Progress of the operation; Cancel stops it and changes nothing.
              </DialogDescription>
            </DialogHeader>
            <JobProgressView
              title={active.title}
              snapshot={active.snapshot}
              cancelling={active.cancelling}
            />
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={active.cancelling}
                onClick={() => void cancelActiveJob()}
              >
                {active.cancelling ? 'Cancelling…' : 'Cancel'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
