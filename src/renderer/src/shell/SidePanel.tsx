import {
  LayoutGrid,
  ListTree,
  MessageSquareText,
  QrCode,
  Search as SearchIcon,
  Sparkles
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { Assistant } from '@/panels/Assistant'
import { Codes } from '@/panels/Codes'
import { Comments } from '@/panels/Comments'
import { Outline } from '@/panels/Outline'
import { Search } from '@/panels/Search'
import { ThumbnailsPanel } from '@/panels/Thumbnails'
import type { DocumentTab, SidePanelId } from '@/state/tabs'
import { openSearch, setSidePanel } from './commands'
import { ToolbarButton } from './ToolbarButton'

const PANELS: { id: SidePanelId; label: string; icon: LucideIcon }[] = [
  { id: 'thumbnails', label: 'Pages', icon: LayoutGrid },
  { id: 'outline', label: 'Outline', icon: ListTree },
  { id: 'search', label: 'Find', icon: SearchIcon },
  { id: 'annotations', label: 'Comments', icon: MessageSquareText },
  { id: 'codes', label: 'QR Codes', icon: QrCode },
  { id: 'assistant', label: 'AI Assistant', icon: Sparkles }
]

function PanelBody({ tab, panel }: { tab: DocumentTab; panel: SidePanelId }): React.JSX.Element {
  switch (panel) {
    case 'thumbnails':
      return <ThumbnailsPanel tab={tab} />
    case 'outline':
      return <Outline tab={tab} />
    case 'search':
      return <Search tab={tab} />
    case 'annotations':
      return <Comments tab={tab} />
    case 'codes':
      return <Codes tab={tab} />
    case 'assistant':
      return <Assistant tab={tab} />
  }
}

/**
 * The left side area: a narrow rail that is always visible and a panel that
 * opens beside it. Which panel is open is remembered per tab.
 */
export function SidePanel({ tab }: { tab: DocumentTab | null }): React.JSX.Element {
  // A document without an outline does not get an Outline button.
  const hasOutline = tab === null || tab.outline === null || tab.outline.length > 0
  const panels = PANELS.filter((item) => item.id !== 'outline' || hasOutline)
  const open = tab?.sidePanel.open ?? false
  const wanted = tab?.sidePanel.panel ?? 'thumbnails'
  const current = panels.find((item) => item.id === wanted) ?? panels[0]

  const select = (panel: SidePanelId): void => {
    if (!tab) return
    if (open && panel === current.id) setSidePanel(tab.id, false)
    else if (panel === 'search') openSearch(tab.id)
    else setSidePanel(tab.id, true, panel)
  }

  return (
    <aside aria-label="Side panel" className="flex shrink-0 border-r bg-background">
      <nav className="flex w-11 flex-col items-center gap-0.5 py-1.5">
        {panels.map((item) => (
          <ToolbarButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            disabled={tab === null}
            active={open && item.id === current.id}
            onClick={() => select(item.id)}
            tooltipSide="right"
          />
        ))}
      </nav>
      {open && tab && (
        <section
          aria-label={current.label}
          className={cn(
            'flex min-h-0 flex-col border-l',
            current.id === 'assistant' ? 'w-96' : 'w-60'
          )}
        >
          <h2 className="flex h-9 shrink-0 items-center border-b px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {current.label}
          </h2>
          <PanelBody key={tab.id} tab={tab} panel={current.id} />
        </section>
      )}
    </aside>
  )
}
