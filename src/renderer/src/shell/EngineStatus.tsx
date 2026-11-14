import { cn } from 'cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEngine, type EngineLink } from '@/state/engine'

const DOT: Record<EngineLink, string> = {
  connecting: 'bg-status-busy animate-pulse',
  reconnecting: 'bg-status-busy animate-pulse',
  connected: 'bg-status-ok',
  failed: 'bg-status-error'
}

const LABEL: Record<EngineLink, string> = {
  connecting: 'Engine starting…',
  reconnecting: 'Engine reconnecting…',
  connected: 'Engine connected',
  failed: 'Engine unavailable'
}

/** The engine connection indicator in the status bar. */
export function EngineStatus(): React.JSX.Element {
  const link = useEngine((state) => state.link)
  const health = useEngine((state) => state.health)
  const message = useEngine((state) => state.message)
  const restarts = useEngine((state) => state.restarts)

  const details: string[] = []
  if (health) {
    details.push(
      `Engine ${health.engineVersion}`,
      `PyMuPDF ${health.pymupdfVersion} (MuPDF ${health.mupdfVersion})`,
      `Python ${health.pythonVersion}`
    )
  }
  if (message) details.push(message)
  if (restarts > 0) details.push(`Restarted ${restarts === 1 ? 'once' : `${restarts} times`}`)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-live="polite"
          data-engine-link={link}
          className="flex items-center gap-1.5 outline-none"
          tabIndex={0}
        >
          <span className={cn('size-2 rounded-full', DOT[link])} aria-hidden />
          <span>{LABEL[link]}</span>
          {health && (
            <span className="text-muted-foreground">
              v{health.engineVersion} · PyMuPDF {health.pymupdfVersion}
            </span>
          )}
        </div>
      </TooltipTrigger>
      {details.length > 0 && (
        <TooltipContent side="top" align="end" sideOffset={6} className="max-w-xs text-left">
          {details.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </TooltipContent>
      )}
    </Tooltip>
  )
}
