import { FileText, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openPath } from '@/state/documents'
import { useRecent } from '@/state/recent'
import { runCommand } from './commands'

/** Shown in the document area while no document is open. */
export function EmptyState(): React.JSX.Element {
  const recent = useRecent((state) => state.files)

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto p-8">
      <div className="my-auto flex w-full max-w-md flex-col items-center gap-5 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl border bg-background text-muted-foreground shadow-xs">
          <FileText className="size-7" strokeWidth={1.5} aria-hidden />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Open a PDF or drop one here</h1>
          <p className="text-[13px] leading-relaxed text-balance text-muted-foreground">
            Each document opens in its own tab.
          </p>
        </div>
        <Button size="sm" onClick={() => runCommand('file.open')}>
          <FolderOpen aria-hidden />
          Open PDF…
        </Button>

        {recent.length > 0 && (
          <section aria-label="Recent files" className="mt-3 w-full text-left">
            <div className="mb-1.5 flex items-center justify-between px-2">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Recent
              </h2>
              <button
                type="button"
                onClick={() => void window.api.files.clearRecent()}
                className="rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                Clear
              </button>
            </div>
            <ul>
              {recent.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => void openPath(file.path)}
                    title={file.path}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <FileText
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{file.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {file.folder}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
