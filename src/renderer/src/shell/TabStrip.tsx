import { useEffect, useRef } from 'react'
import { FileText, Lock, X } from 'lucide-react'
import { cn } from 'cn'
import { closeTab } from '@/state/documents'
import { useTabs, type DocumentTab } from '@/state/tabs'

interface TabProps {
  tab: DocumentTab
  active: boolean
}

function Tab({ tab, active }: TabProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const activate = useTabs((state) => state.activateTab)

  // A tab that becomes active is scrolled into the strip if it is out of it.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={tab.history.modified ? `${tab.filePath} (unsaved changes)` : tab.filePath}
      data-tab-id={tab.id}
      onClick={() => activate(tab.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate(tab.id)
        }
      }}
      // The middle button closes a tab; without this it would start
      // Chromium's auto-scroll instead.
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          void closeTab(tab.id)
        }
      }}
      className={cn(
        'group relative flex h-8 max-w-56 min-w-28 shrink items-center gap-1.5 rounded-t-md border border-b-0 pr-1 pl-2.5 text-xs outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
        active
          ? 'border-border bg-canvas text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      {tab.isEncrypted ? (
        <Lock className="size-3.5 shrink-0 opacity-70" aria-label="Password protected" />
      ) : (
        <FileText className="size-3.5 shrink-0 opacity-70" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">{tab.fileName}</span>
      {tab.history.modified && (
        <span
          className="size-2 shrink-0 rounded-full bg-foreground/60"
          role="img"
          aria-label="Unsaved changes"
          data-modified
        />
      )}
      <button
        type="button"
        aria-label={`Close ${tab.fileName}`}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
          void closeTab(tab.id)
        }}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-foreground/10',
          active ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70'
        )}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** The strip of open documents: one tab each. */
export function TabStrip(): React.JSX.Element {
  const tabs = useTabs((state) => state.tabs)
  const activeTabId = useTabs((state) => state.activeTabId)

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="tab-strip flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto overflow-y-hidden bg-muted/60 px-2"
    >
      {tabs.length === 0 && (
        <span className="self-center px-1 text-xs text-muted-foreground">No documents open</span>
      )}
      {tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} active={tab.id === activeTabId} />
      ))}
    </div>
  )
}
