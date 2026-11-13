import { useEffect, useState } from 'react'
import { selectActiveTab, useTabs } from '@/state/tabs'
import { formatZoom } from '@/viewer/zoom'
import { EngineStatus } from './EngineStatus'

function Divider(): React.JSX.Element {
  return <span className="h-3 w-px shrink-0 bg-border" aria-hidden />
}

/** Page size in millimetres, the way paper sizes are usually given. */
function describeSize(width: number, height: number): string {
  const toMm = (points: number): number => Math.round((points / 72) * 25.4)
  return `${toMm(width)} × ${toMm(height)} mm`
}

export function StatusBar(): React.JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  const tab = useTabs(selectActiveTab)
  const page = tab?.pages[tab.page]

  useEffect(() => {
    let cancelled = false
    void window.api.app.getVersion().then((value) => {
      if (!cancelled) setVersion(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 border-t bg-background px-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        {tab ? (
          <>
            <span className="truncate" title={tab.filePath}>
              {tab.fileName}
            </span>
            <Divider />
            <span className="shrink-0 tabular-nums">
              Page {tab.page + 1} of {tab.pageCount.toLocaleString()}
            </span>
            <Divider />
            <span className="shrink-0 tabular-nums">{formatZoom(tab.zoom)}</span>
            {page && (
              <>
                <Divider />
                <span className="shrink-0 tabular-nums max-lg:hidden">
                  {describeSize(page.width, page.height)}
                </span>
              </>
            )}
          </>
        ) : (
          <span>No document open</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <EngineStatus />
        {version && (
          <>
            <Divider />
            <span>PDFnix {version}</span>
          </>
        )}
      </div>
    </footer>
  )
}
