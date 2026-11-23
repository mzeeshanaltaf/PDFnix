import { memo, useState } from 'react'
import { CodeActions, CodeText } from '@/panels/Codes'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTools } from '@/state/tools'
import { useCodeScan, type FoundCode } from './codeScan'
import { rectToPx } from './geometry'

interface CodeLayerProps {
  tabId: string
  page: number
  /** The revision that last changed this page; older results are not shown. */
  revision: number
  zoom: number
}

/**
 * The QR codes and barcodes found on a page: a dashed outline around each
 * that, with the select tool, opens a pop-up with the content and Copy/Open.
 * A code picked in the panel or dialog blinks once.
 */
export const CodeLayer = memo(function CodeLayer({
  tabId,
  page,
  revision,
  zoom
}: CodeLayerProps): React.JSX.Element | null {
  const active = useTools((state) => state.activeTool === 'select')
  const result = useCodeScan((state) => state.scans[tabId]?.pages[page])
  const flash = useCodeScan((state) =>
    state.flash && state.flash.tabId === tabId && state.flash.page === page ? state.flash : null
  )
  const [open, setOpen] = useState<number | null>(null)

  if (!result || result.revision !== revision || result.codes.length === 0) return null
  const flashed = flash ? result.codes[flash.index] : undefined

  return (
    <div className="pdf-code-layer" data-page-index={page}>
      {active &&
        result.codes.map((code, index) => {
          const found: FoundCode = { page, index, code }
          const label = `${code.format}: ${code.binary ? 'binary data' : code.text}`
          return (
            <Popover
              key={index}
              open={open === index}
              onOpenChange={(next) => setOpen(next ? index : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="pdf-code"
                  style={rectToPx(code.rect, zoom)}
                  title={`${code.format} — click to read`}
                  aria-label={label.length > 200 ? `${label.slice(0, 200)}…` : label}
                />
              </PopoverTrigger>
              <PopoverContent className="w-80 text-[13px]" side="right" align="start">
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {code.format} · page {page + 1}
                </p>
                <div className="max-h-48 overflow-y-auto">
                  <CodeText found={found} clamp={false} />
                </div>
                <div className="mt-2 -ml-1.5">
                  <CodeActions found={found} />
                </div>
              </PopoverContent>
            </Popover>
          )
        })}
      {flash && flashed && (
        <div
          key={flash.serial}
          className="pdf-code-flash"
          style={rectToPx(flashed.rect, zoom)}
          aria-hidden
        />
      )}
    </div>
  )
})
