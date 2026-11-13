import { useEffect, useState } from 'react'
import { FileDown } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PasswordDialog } from '@/dialogs/PasswordDialog'
import { PreferencesDialog } from '@/dialogs/PreferencesDialog'
import { PropertiesDialog } from '@/dialogs/PropertiesDialog'
import { RecoveryDialog } from '@/dialogs/RecoveryDialog'
import { SelectionToolbar } from '@/tools/SelectionToolbar'
import { runCommand } from '@/shell/commands'
import { EmptyState } from '@/shell/EmptyState'
import { installShortcuts } from '@/shell/shortcuts'
import { SidePanel } from '@/shell/SidePanel'
import { StatusBar } from '@/shell/StatusBar'
import { TabStrip } from '@/shell/TabStrip'
import { Toolbar } from '@/shell/Toolbar'
import { openDroppedFiles, startDocumentSync } from '@/state/documents'
import { startEngineMonitor } from '@/state/engine'
import { startRecentSync } from '@/state/recent'
import { startSettingsSync } from '@/state/settings'
import { selectActiveTab, useTabs } from '@/state/tabs'
import { PageList } from '@/viewer/PageList'

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

/** Opens PDFs dropped anywhere on the window. Returns whether a drop is in progress. */
function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // dragenter and dragleave fire for every element the pointer crosses.
    let depth = 0
    const onEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const onOver = (event: DragEvent): void => {
      // Without this the drop is refused; with it nothing can navigate the window.
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = carriesFiles(event) ? 'copy' : 'none'
      }
    }
    const onLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      depth = 0
      setDragging(false)
      const files = event.dataTransfer?.files
      if (files && files.length > 0) void openDroppedFiles(Array.from(files))
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return dragging
}

function App(): React.JSX.Element {
  const tab = useTabs(selectActiveTab)
  const dragging = useFileDrop()

  useEffect(() => startEngineMonitor(), [])
  useEffect(() => startSettingsSync(), [])
  useEffect(() => startRecentSync(), [])
  useEffect(() => startDocumentSync(), [])
  useEffect(() => installShortcuts(), [])
  useEffect(() => window.api.menu.onCommand(runCommand), [])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <Toolbar />
        <TabStrip />
        <div className="flex min-h-0 flex-1">
          <SidePanel tab={tab} />
          <main className="relative min-w-0 flex-1 bg-canvas">
            {tab ? <PageList key={tab.id} tab={tab} /> : <EmptyState />}
          </main>
        </div>
        <StatusBar />
      </div>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
          <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-background px-6 py-4 text-sm font-medium shadow-lg">
            <FileDown className="size-5 text-primary" aria-hidden />
            Drop to open
          </div>
        </div>
      )}
      <SelectionToolbar />
      <RecoveryDialog />
      <PreferencesDialog />
      {/* Last, so the password prompt shows above the recovery dialog. */}
      <PasswordDialog />
      <PropertiesDialog />
      <Toaster position="bottom-right" offset={{ bottom: 36, right: 16 }} />
    </TooltipProvider>
  )
}

export default App
