import { useEffect } from 'react'
import { Copy, ExternalLink, Loader2, QrCode } from 'lucide-react'
import { cn } from 'cn'
import { copyText } from '@/lib/clipboard'
import type { DocumentTab } from '@/state/tabs'
import {
  requestCodeScan,
  revealCode,
  useTabCodes,
  type FoundCode,
  type ScanProgress
} from '@/viewer/codeScan'
import { getViewer } from '@/viewer/controller'
import { openWebLink } from '@/viewer/openLink'
import { codeLinkTarget, groupCodes } from './codeRows'

const ICON_BUTTON =
  'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'

/** Copy and Open buttons for one code. */
export function CodeActions({ found }: { found: FoundCode }): React.JSX.Element {
  const target = codeLinkTarget(found.code)
  return (
    <div className="flex flex-wrap gap-0.5">
      <button
        type="button"
        className={ICON_BUTTON}
        onClick={() => void copyText(found.code.text, found.code.binary ? 'Data' : 'Text')}
      >
        <Copy className="size-3.5" aria-hidden /> Copy
      </button>
      {target && (
        <button type="button" className={ICON_BUTTON} onClick={() => void openWebLink(target)}>
          <ExternalLink className="size-3.5" aria-hidden />
          {target.startsWith('mailto:') ? 'Write e-mail…' : 'Open link…'}
        </button>
      )}
    </div>
  )
}

/** The decoded content, kept readable however long or odd it is. */
export function CodeText({
  found,
  clamp
}: {
  found: FoundCode
  clamp: boolean
}): React.JSX.Element {
  return (
    <p
      className={cn(
        'break-all whitespace-pre-wrap text-foreground select-text',
        found.code.binary && 'font-mono text-xs',
        clamp && 'line-clamp-3'
      )}
    >
      {found.code.binary && (
        <span className="mr-1 font-sans text-muted-foreground italic">Binary data:</span>
      )}
      {found.code.text || <span className="text-muted-foreground italic">Empty</span>}
    </p>
  )
}

function CodeItem({
  tab,
  found,
  clamp,
  onReveal
}: {
  tab: DocumentTab
  found: FoundCode
  clamp: boolean
  onReveal?: () => void
}): React.JSX.Element {
  return (
    <li className="group rounded-md border border-transparent px-2.5 py-2 text-[13px] hover:bg-accent/60">
      <button
        type="button"
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onClick={() => {
          revealCode(tab.id, found, () => getViewer(tab.id)?.reveal(found.page, found.code.rect))
          onReveal?.()
        }}
      >
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <QrCode className="size-3.5 shrink-0" aria-hidden />
          <span className="font-medium text-foreground/80">{found.code.format}</span>
        </div>
      </button>
      <div className="mt-1">
        <CodeText found={found} clamp={clamp} />
      </div>
      <div className="mt-1">
        <CodeActions found={found} />
      </div>
    </li>
  )
}

export function ScanStatus({ progress }: { progress: ScanProgress }): React.JSX.Element | null {
  if (progress.done) return null
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      Looking for codes… {progress.scanned} of {progress.total} pages
    </p>
  )
}

/** The codes of a tab grouped by page; shared by the panel and the dialog. */
export function CodeList({
  tab,
  found,
  progress,
  clamp,
  onReveal
}: {
  tab: DocumentTab
  found: FoundCode[]
  progress: ScanProgress
  clamp: boolean
  onReveal?: () => void
}): React.JSX.Element {
  if (found.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-[13px] text-muted-foreground">
        <QrCode className="size-5 opacity-60" aria-hidden />
        {progress.done ? 'No QR codes or barcodes in this document.' : 'None found yet.'}
      </div>
    )
  }
  return (
    <>
      {groupCodes(found).map((group) => (
        <section key={group.page} className="mb-2">
          <h3 className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Page {group.page + 1}
          </h3>
          <ul className="grid gap-1">
            {group.codes.map((item) => (
              <CodeItem
                key={`${item.page}-${item.index}`}
                tab={tab}
                found={item}
                clamp={clamp}
                onReveal={onReveal}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

/** The side panel: every QR code and barcode found in the document. */
export function Codes({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const { codes, progress } = useTabCodes(tab)
  useEffect(() => requestCodeScan(tab.id), [tab.id])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 items-center gap-2 border-b px-3 py-2">
        {progress.done ? (
          <span className="text-xs text-muted-foreground tabular-nums">{codes.length} found</span>
        ) : (
          <ScanStatus progress={progress} />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <CodeList tab={tab} found={codes} progress={progress} clamp />
      </div>
    </div>
  )
}
