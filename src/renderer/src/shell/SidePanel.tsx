import { LayoutGrid, ListTree, MessageSquareText, type LucideIcon } from 'lucide-react'
import { ToolbarButton } from './ToolbarButton'

export type SidePanelId = 'thumbnails' | 'outline' | 'annotations'

const PANELS: { id: SidePanelId; label: string; icon: LucideIcon; empty: string }[] = [
  {
    id: 'thumbnails',
    label: 'Pages',
    icon: LayoutGrid,
    empty: 'Page thumbnails appear here when a document is open.'
  },
  {
    id: 'outline',
    label: 'Outline',
    icon: ListTree,
    empty: 'The document outline appears here when a document has one.'
  },
  {
    id: 'annotations',
    label: 'Comments',
    icon: MessageSquareText,
    empty: 'Highlights and comments appear here once you add them.'
  }
]

interface SidePanelProps {
  open: boolean
  panel: SidePanelId
  /** Called with the panel whose rail button was pressed. */
  onSelect: (panel: SidePanelId) => void
}

/**
 * The left side area: a narrow rail that is always visible and a panel that
 * is collapsed by default. The panels get their content in phase 2 and later.
 */
export function SidePanel({ open, panel, onSelect }: SidePanelProps): React.JSX.Element {
  const current = PANELS.find((item) => item.id === panel) ?? PANELS[0]

  return (
    <aside aria-label="Side panel" className="flex shrink-0 border-r bg-background">
      <nav className="flex w-11 flex-col items-center gap-0.5 py-1.5">
        {PANELS.map((item) => (
          <ToolbarButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={open && item.id === panel}
            onClick={() => onSelect(item.id)}
            tooltipSide="right"
          />
        ))}
      </nav>
      {open && (
        <section aria-label={current.label} className="flex w-60 flex-col border-l">
          <h2 className="flex h-9 shrink-0 items-center border-b px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {current.label}
          </h2>
          <p className="px-3 py-4 text-[13px] leading-relaxed text-muted-foreground">
            {current.empty}
          </p>
        </section>
      )}
    </aside>
  )
}
