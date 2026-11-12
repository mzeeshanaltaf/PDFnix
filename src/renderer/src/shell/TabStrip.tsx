import { useTabs } from '@/state/tabs'

/** The strip of open documents. Empty until phase 2 can open files. */
export function TabStrip(): React.JSX.Element {
  const tabs = useTabs((state) => state.tabs)

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex h-9 shrink-0 items-end border-b bg-muted/60 px-2"
    >
      {tabs.length === 0 && (
        <span className="self-center px-1 text-xs text-muted-foreground">No documents open</span>
      )}
    </div>
  )
}
