import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  File,
  FolderOpen,
  Hand,
  Highlighter,
  Image,
  MessageSquare,
  MousePointer2,
  MoveHorizontal,
  PanelLeft,
  Printer,
  Redo2,
  RotateCcw,
  RotateCw,
  Rows2,
  Save,
  Scan,
  Search,
  Signature,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from 'lucide-react'
import { isLayoutMode, type LayoutMode } from '../../../shared/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { selectActiveTab, useTabs } from '@/state/tabs'
import { useTools, type ToolId } from '@/state/tools'
import { runCommand } from './commands'
import { ThemeMenu } from './ThemeMenu'
import { ToolbarButton } from './ToolbarButton'
import { PageNumberBox, ZoomBox } from './ToolbarFields'

/** Tools of later phases: laid out and labelled, not available yet. */
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

const LAYOUTS: { value: LayoutMode; label: string; icon: LucideIcon }[] = [
  { value: 'continuous', label: 'Continuous', icon: Rows2 },
  { value: 'single', label: 'Single page', icon: File },
  { value: 'two-page', label: 'Two pages', icon: Columns2 }
]

function Divider({ className }: { className?: string }): React.JSX.Element {
  return <Separator orientation="vertical" className={`mx-1.5 h-5! ${className ?? ''}`} />
}

/** The top toolbar. Everything on it acts on the active tab. */
export function Toolbar(): React.JSX.Element {
  const tab = useTabs(selectActiveTab)
  const activeTool = useTools((state) => state.activeTool)
  const none = tab === null
  const sidePanelOpen = tab?.sidePanel.open ?? false
  const searching = sidePanelOpen && tab?.sidePanel.panel === 'search'
  const layout = LAYOUTS.find((item) => item.value === tab?.layout) ?? LAYOUTS[0]
  const twoPage = tab?.layout === 'two-page'
  const atFirst = none || tab.page <= 0
  const atLast = none || tab.page >= tab.pageCount - (twoPage ? 2 - (tab.page % 2) : 1)

  return (
    <header
      role="toolbar"
      aria-label="Main toolbar"
      className="flex h-11 shrink-0 items-center gap-0.5 overflow-hidden border-b bg-background px-2"
    >
      <ToolbarButton
        icon={PanelLeft}
        label={sidePanelOpen ? 'Hide side panel' : 'Show side panel'}
        shortcut="F4"
        active={sidePanelOpen}
        disabled={none}
        onClick={() => runCommand('view.toggleSidePanel')}
      />
      <Divider />
      <ToolbarButton
        icon={FolderOpen}
        label="Open"
        shortcut="Ctrl+O"
        onClick={() => runCommand('file.open')}
      />
      <ToolbarButton icon={Save} label="Save" shortcut="Ctrl+S" disabled />
      <ToolbarButton icon={Printer} label="Print" shortcut="Ctrl+P" disabled />
      <Divider className="max-xl:hidden" />
      <ToolbarButton
        icon={Undo2}
        label="Undo"
        shortcut="Ctrl+Z"
        disabled
        className="max-xl:hidden"
      />
      <ToolbarButton
        icon={Redo2}
        label="Redo"
        shortcut="Ctrl+Y"
        disabled
        className="max-xl:hidden"
      />
      <Divider />

      <ToolbarButton
        icon={ChevronLeft}
        label="Previous page"
        shortcut="←"
        disabled={atFirst}
        onClick={() => runCommand('go.previousPage')}
      />
      <PageNumberBox tab={tab} />
      <ToolbarButton
        icon={ChevronRight}
        label="Next page"
        shortcut="→"
        disabled={atLast}
        onClick={() => runCommand('go.nextPage')}
      />
      <Divider />

      <ToolbarButton
        icon={ZoomOut}
        label="Zoom out"
        shortcut="Ctrl+−"
        disabled={none}
        onClick={() => runCommand('view.zoomOut')}
      />
      <ZoomBox tab={tab} />
      <ToolbarButton
        icon={ZoomIn}
        label="Zoom in"
        shortcut="Ctrl++"
        disabled={none}
        onClick={() => runCommand('view.zoomIn')}
      />
      <ToolbarButton
        icon={MoveHorizontal}
        label="Fit width"
        shortcut="Ctrl+1"
        disabled={none}
        active={tab?.zoomMode === 'fit-width'}
        onClick={() => runCommand('view.fitWidth')}
      />
      <ToolbarButton
        icon={Scan}
        label="Fit page"
        shortcut="Ctrl+2"
        disabled={none}
        active={tab?.zoomMode === 'fit-page'}
        onClick={() => runCommand('view.fitPage')}
      />
      <Divider />

      <ToolbarButton
        icon={RotateCcw}
        label="Rotate page left"
        shortcut="Ctrl+Shift+R"
        disabled={none}
        onClick={() => runCommand('view.rotateCcw')}
      />
      <ToolbarButton
        icon={RotateCw}
        label="Rotate page right"
        shortcut="Ctrl+R"
        disabled={none}
        onClick={() => runCommand('view.rotateCw')}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={none}>
          <ToolbarButton icon={ChevronDown} label="More rotate options" compact disabled={none} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuItem onSelect={() => runCommand('view.rotateAllCcw')}>
            <RotateCcw aria-hidden />
            Rotate all pages left
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runCommand('view.rotateAllCw')}>
            <RotateCw aria-hidden />
            Rotate all pages right
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={none}>
          <ToolbarButton icon={layout.icon} label="Page layout" disabled={none} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuLabel>Page layout</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={tab?.layout}
            onValueChange={(value) => {
              if (isLayoutMode(value)) runCommand(`view.layout.${value}`)
            }}
          >
            {LAYOUTS.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon className="size-4" aria-hidden />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider className="max-[1180px]:hidden" />
      <div className="flex items-center gap-0.5 max-[1180px]:hidden">
        {TOOLS.map((tool) => (
          <ToolbarButton
            key={tool.id}
            icon={tool.icon}
            label={tool.label}
            disabled
            active={activeTool === tool.id}
          />
        ))}
      </div>

      <div className="flex-1" />
      <ToolbarButton
        icon={Search}
        label="Find"
        shortcut="Ctrl+F"
        disabled={none}
        active={searching}
        onClick={() => runCommand('edit.find')}
      />
      <Divider />
      <ThemeMenu />
    </header>
  )
}
