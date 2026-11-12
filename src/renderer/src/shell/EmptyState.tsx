import { FileText } from 'lucide-react'

/** Shown in the document area while no document is open. */
export function EmptyState(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border bg-background text-muted-foreground shadow-xs">
        <FileText className="size-7" strokeWidth={1.5} aria-hidden />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Open a PDF or drop one here</h1>
        <p className="max-w-sm text-[13px] leading-relaxed text-balance text-muted-foreground">
          Opening documents is not part of this build yet. It arrives with the viewer.
        </p>
      </div>
    </div>
  )
}
