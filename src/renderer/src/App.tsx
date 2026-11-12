import { useEffect, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EmptyState } from '@/shell/EmptyState'
import { SidePanel, type SidePanelId } from '@/shell/SidePanel'
import { StatusBar } from '@/shell/StatusBar'
import { TabStrip } from '@/shell/TabStrip'
import { Toolbar } from '@/shell/Toolbar'
import { startEngineMonitor } from '@/state/engine'
import { startSettingsSync } from '@/state/settings'

function App(): React.JSX.Element {
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [sidePanel, setSidePanel] = useState<SidePanelId>('thumbnails')

  useEffect(() => startEngineMonitor(), [])
  useEffect(() => startSettingsSync(), [])

  // Dropping a file must never navigate the window away from the app.
  // Phase 2 replaces this with opening the dropped PDF.
  useEffect(() => {
    const ignore = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', ignore)
    window.addEventListener('drop', ignore)
    return () => {
      window.removeEventListener('dragover', ignore)
      window.removeEventListener('drop', ignore)
    }
  }, [])

  const selectSidePanel = (panel: SidePanelId): void => {
    if (sidePanelOpen && panel === sidePanel) {
      setSidePanelOpen(false)
    } else {
      setSidePanel(panel)
      setSidePanelOpen(true)
    }
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <Toolbar
          sidePanelOpen={sidePanelOpen}
          onToggleSidePanel={() => setSidePanelOpen((open) => !open)}
        />
        <TabStrip />
        <div className="flex min-h-0 flex-1">
          <SidePanel open={sidePanelOpen} panel={sidePanel} onSelect={selectSidePanel} />
          <main className="min-w-0 flex-1 bg-canvas">
            <EmptyState />
          </main>
        </div>
        <StatusBar />
      </div>
      <Toaster position="bottom-right" offset={{ bottom: 36, right: 16 }} />
    </TooltipProvider>
  )
}

export default App
