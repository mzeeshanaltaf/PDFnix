import { useState } from 'react'
import {
  Copy,
  FileOutput,
  FilePlus2,
  RotateCcw,
  RotateCw,
  SquarePlus,
  Trash2,
  Undo2,
  Redo2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { organiserActions } from '@/panels/organiserActions'
import { PageOrganiser } from '@/panels/PageOrganiser'
import { showToolDialog, useDialogs } from '@/state/dialogs'
import { redo, undo } from '@/state/edits'
import { useTabs, type DocumentTab } from '@/state/tabs'
import { getViewer } from '@/viewer/controller'

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled
}: {
  icon: typeof Copy
  label: string
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="h-8 gap-1.5 px-2 text-xs"
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Button>
  )
}

function Organiser({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const [selected, setSelected] = useState<number[]>([])
  // The organiser keeps its own selection; actions here clear it with the token.
  const [generation, setGeneration] = useState(0)
  const actions = organiserActions(tab, selected, () => setGeneration((count) => count + 1))
  const none = selected.length === 0
  const close = (): void => showToolDialog('organiseTabId', null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b px-3 py-1.5">
        <DialogTitle className="mr-3 text-sm font-semibold">Organise Pages</DialogTitle>
        <DialogDescription className="sr-only">
          Select pages with click, Ctrl+click and Shift+click; drag to reorder; Delete removes them.
        </DialogDescription>
        <ToolButton
          icon={RotateCcw}
          label="Left"
          onClick={() => actions.rotate(-90)}
          disabled={none}
        />
        <ToolButton
          icon={RotateCw}
          label="Right"
          onClick={() => actions.rotate(90)}
          disabled={none}
        />
        <ToolButton icon={Copy} label="Duplicate" onClick={actions.duplicate} disabled={none} />
        <ToolButton
          icon={Trash2}
          label="Delete"
          onClick={actions.remove}
          disabled={none || selected.length >= tab.pageCount}
        />
        <ToolButton icon={FileOutput} label="Extract…" onClick={actions.extract} disabled={none} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton
          icon={SquarePlus}
          label="Blank page"
          onClick={() => actions.insertBlank('after')}
        />
        <ToolButton
          icon={FilePlus2}
          label="Insert file…"
          onClick={() => actions.insertFile('after')}
        />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton
          icon={Undo2}
          label="Undo"
          onClick={() => void undo(tab.id)}
          disabled={!tab.history.canUndo}
        />
        <ToolButton
          icon={Redo2}
          label="Redo"
          onClick={() => void redo(tab.id)}
          disabled={!tab.history.canRedo}
        />
        <span className="ml-auto pr-8 text-xs text-muted-foreground tabular-nums">
          {selected.length > 0
            ? `${selected.length} of ${tab.pageCount} selected`
            : `${tab.pageCount} pages`}
        </span>
      </div>
      <PageOrganiser
        resetToken={generation}
        tab={tab}
        layout="grid"
        className="bg-canvas"
        onSelectionChange={setSelected}
        onOpenPage={(index) => {
          close()
          getViewer(tab.id)?.goToPage(index)
        }}
      />
      <p className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        Click, Ctrl+click or Shift+click to select · drag to move · Ctrl+arrows move the selection ·
        Delete removes · drop a PDF between pages to insert it · double-click opens a page
      </p>
    </div>
  )
}

/** The page organiser as a full window over the app. */
export function OrganiseDialog(): React.JSX.Element {
  const tabId = useDialogs((state) => state.organiseTabId)
  const tab = useTabs((state) => state.tabs.find((candidate) => candidate.id === tabId) ?? null)
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => !open && showToolDialog('organiseTabId', null)}
    >
      <DialogContent
        className="flex h-[88vh] max-w-[94vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[94vw]"
        onKeyDown={(event) => {
          // Undo/redo work while organising.
          if (!tab || !event.ctrlKey) return
          const key = event.key.toLowerCase()
          if (key === 'z' && !event.shiftKey) {
            event.preventDefault()
            void undo(tab.id)
          } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
            event.preventDefault()
            void redo(tab.id)
          }
        }}
      >
        {tab && <Organiser tab={tab} />}
      </DialogContent>
    </Dialog>
  )
}
