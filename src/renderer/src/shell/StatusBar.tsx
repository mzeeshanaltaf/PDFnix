import { useEffect, useState } from 'react'
import { EngineStatus } from './EngineStatus'

export function StatusBar(): React.JSX.Element {
  const [version, setVersion] = useState<string | null>(null)

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
      <span>No document open</span>
      <div className="flex items-center gap-3">
        <EngineStatus />
        {version && (
          <>
            <span className="h-3 w-px bg-border" aria-hidden />
            <span>PDFnix {version}</span>
          </>
        )}
      </div>
    </footer>
  )
}
