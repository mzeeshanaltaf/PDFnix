import { useEffect, useState } from 'react'
import { FileDown } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AboutDialog } from '@/dialogs/AboutDialog'
import { CodesDialog } from '@/dialogs/CodesDialog'
import { CompressDialog } from '@/dialogs/CompressDialog'
import { ConfirmDialog } from '@/dialogs/ConfirmDialog'
import { ConvertDialog } from '@/dialogs/ConvertDialog'
import { ImagesToPdfDialog } from '@/dialogs/ImagesToPdfDialog'
import { JobProgressDialog } from '@/dialogs/JobProgress'
import { OcrDialog } from '@/dialogs/OcrDialog'
import { OcrLanguagesDialog } from '@/dialogs/OcrLanguagesDialog'
import { PrintDialog } from '@/dialogs/PrintDialog'
import { ProtectDialog } from '@/dialogs/ProtectDialog'
import { HeaderFooterDialog } from '@/dialogs/HeaderFooterDialog'
import { MergeDialog } from '@/dialogs/MergeDialog'
import { OrganiseDialog } from '@/dialogs/OrganiseDialog'
import { PageRangeDialog } from '@/dialogs/PageRangeDialog'
import { PasswordDialog } from '@/dialogs/PasswordDialog'
import { RedactDialog } from '@/dialogs/RedactDialog'
import { ShortcutsDialog } from '@/dialogs/ShortcutsDialog'
import { SplitDialog } from '@/dialogs/SplitDialog'
import { WatermarkDialog } from '@/dialogs/WatermarkDialog'
import { FormBar } from '@/shell/FormBar'
import { PreferencesDialog } from '@/dialogs/PreferencesDialog'
import { PropertiesDialog } from '@/dialogs/PropertiesDialog'
import { RecoveryDialog } from '@/dialogs/RecoveryDialog'
import { SignatureDialog } from '@/dialogs/SignatureDialog'
import { SelectionMenu } from '@/tools/SelectionMenu'
import { installAssistantMenu } from '@/tools/assistantMenu'
import { runCommand } from '@/shell/commands'
import { EmptyState } from '@/shell/EmptyState'
import { installShortcuts } from '@/shell/shortcuts'
import { installPendingCommits } from '@/state/pending'
import { installImagePaste } from '@/tools/images'
import { SidePanel } from '@/shell/SidePanel'
import { StatusBar } from '@/shell/StatusBar'
import { TabStrip } from '@/shell/TabStrip'
import { Toolbar } from '@/shell/Toolbar'
import { openDroppedFiles, startDocumentSync } from '@/state/documents'
import { startEngineMonitor } from '@/state/engine'
import { startRecentSync } from '@/state/recent'
import { startSettingsSync } from '@/state/settings'
import { selectActiveTab, useTabs } from '@/state/tabs'
import { startCodeScanner } from '@/viewer/codeScan'
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
    // The page organiser takes files dropped on it itself (to insert them).
    const overOrganiser = (event: DragEvent): boolean =>
      event.target instanceof Element && event.target.closest('[data-page-organiser]') !== null
    const onEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return
      depth += 1
      setDragging(!overOrganiser(event))
    }
    const onOver = (event: DragEvent): void => {
      // Other drags (pages in the organiser, files in the merge list) are
      // their targets' business.
      if (!carriesFiles(event)) return
      // Without this the drop is refused; with it nothing can navigate the window.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDragging(!overOrganiser(event))
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
      // The organiser has inserted the files already.
      if (overOrganiser(event)) return
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
  useEffect(() => startCodeScanner(), [])
  useEffect(() => installShortcuts(), [])
  useEffect(() => installPendingCommits(), [])
  useEffect(() => installAssistantMenu(), [])
  useEffect(() => installImagePaste(() => useTabs.getState().activeTabId), [])
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
            {tab && <FormBar tab={tab} />}
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
      <SelectionMenu />
      <RecoveryDialog />
      <PreferencesDialog />
      <SignatureDialog />
      <OrganiseDialog />
      <SplitDialog />
      <MergeDialog />
      <RedactDialog />
      <WatermarkDialog />
      <HeaderFooterDialog />
      <CompressDialog />
      <ProtectDialog />
      <OcrDialog />
      <OcrLanguagesDialog />
      <ConvertDialog />
      <CodesDialog />
      <ImagesToPdfDialog />
      <PrintDialog />
      <JobProgressDialog />
      <PageRangeDialog />
      <ConfirmDialog />
      <ShortcutsDialog />
      <AboutDialog />
      {/* Last, so the password prompt shows above the other dialogs. */}
      <PasswordDialog />
      <PropertiesDialog />
      <Toaster position="bottom-right" offset={{ bottom: 36, right: 16 }} />
    </TooltipProvider>
  )
}

export default App
