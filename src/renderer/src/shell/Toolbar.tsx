import {
  FolderOpen,
  Hand,
  Highlighter,
  Image,
  MessageSquare,
  MousePointer2,
  PanelLeft,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Search,
  Signature,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { useTools, type ToolId } from '@/state/tools'
import { ThemeMenu } from './ThemeMenu'
import { ToolbarButton } from './ToolbarButton'

const TOOLS: { id: ToolId; label: string; icon: LucideIcon }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'hand', label: 'Pan', icon: Hand },
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'comment', label: 'Comment', icon: MessageSquare },
  { id: 'text', label: 'Add text', icon: Type },
  { id: 'image', label: 'Add image', icon: Image },
  { id: 'shape', label: 'Add shape', icon: Square },
  { id: 'signature', label: 'Sign', icon: Signature }
]

function Divider(): React.JSX.Element {
  return <Separator orientation="vertical" className="mx-1.5 h-5!" />
}

interface ToolbarProps {
  sidePanelOpen: boolean
  onToggleSidePanel: () => void
}

/**
 * The top toolbar. In phase 1 the document actions are placeholders: they are
 * laid out and labelled but unavailable until the phase that implements them.
 */
export function Toolbar({ sidePanelOpen, onToggleSidePanel }: ToolbarProps): React.JSX.Element {
  const activeTool = useTools((state) => state.activeTool)
  const setActiveTool = useTools((state) => state.setActiveTool)
  // Nothing can act on a document until the viewer exists (phase 2).
  const unavailable = true

  return (
    <header
      role="toolbar"
      aria-label="Main toolbar"
      className="flex h-11 shrink-0 items-center gap-0.5 border-b bg-background px-2"
    >
      <ToolbarButton
        icon={PanelLeft}
        label={sidePanelOpen ? 'Hide side panel' : 'Show side panel'}
        active={sidePanelOpen}
        onClick={onToggleSidePanel}
      />
      <Divider />
      <ToolbarButton icon={FolderOpen} label="Open" shortcut="Ctrl+O" disabled={unavailable} />
      <ToolbarButton icon={Save} label="Save" shortcut="Ctrl+S" disabled={unavailable} />
      <ToolbarButton icon={Printer} label="Print" shortcut="Ctrl+P" disabled={unavailable} />
      <Divider />
      <ToolbarButton icon={Undo2} label="Undo" shortcut="Ctrl+Z" disabled={unavailable} />
      <ToolbarButton icon={Redo2} label="Redo" shortcut="Ctrl+Y" disabled={unavailable} />
      <Divider />
      <ToolbarButton icon={ZoomOut} label="Zoom out" shortcut="Ctrl+−" disabled={unavailable} />
      <span
        aria-label="Zoom level"
        className="w-12 text-center text-xs tabular-nums text-muted-foreground/50"
      >
        100%
      </span>
      <ToolbarButton icon={ZoomIn} label="Zoom in" shortcut="Ctrl++" disabled={unavailable} />
      <ToolbarButton icon={RotateCw} label="Rotate" shortcut="Ctrl+R" disabled={unavailable} />
      <Divider />
      {TOOLS.map((tool) => (
        <ToolbarButton
          key={tool.id}
          icon={tool.icon}
          label={tool.label}
          disabled={unavailable}
          active={activeTool === tool.id}
          onClick={() => setActiveTool(tool.id)}
        />
      ))}
      <div className="flex-1" />
      <ToolbarButton icon={Search} label="Find" shortcut="Ctrl+F" disabled={unavailable} />
      <Divider />
      <ThemeMenu />
    </header>
  )
}
