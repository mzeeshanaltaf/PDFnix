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
  StickyNote,
  Strikethrough,
  Type,
  Underline,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { selectActiveTab, useTabs } from '@/state/tabs'
import { isMarkupTool, PALETTE, useTools, type AnnotationTool, type ToolId } from '@/state/tools'
import { runCommand, type CommandId } from './commands'
import { ThemeMenu } from './ThemeMenu'
import { ToolbarButton } from './ToolbarButton'
import { PageNumberBox, ZoomBox } from './ToolbarFields'

/** The tools. Those without a command arrive in later phases and are shown disabled. */
const TOOLS: {
  id: ToolId
  label: string
  icon: LucideIcon
  command?: CommandId
  shortcut?: string
}[] = [
  { id: 'select', label: 'Select', icon: MousePointer2, command: 'tools.select', shortcut: 'V' },
  { id: 'hand', label: 'Pan', icon: Hand },
  {
    id: 'highlight',
    label: 'Highlight',
    icon: Highlighter,
    command: 'tools.highlight',
    shortcut: 'H'
  },
  {
    id: 'underline',
    label: 'Underline',
    icon: Underline,
    command: 'tools.underline',
    shortcut: 'U'
  },
  {
    id: 'strikeout',
    label: 'Strikeout',
    icon: Strikethrough,
    command: 'tools.strikeout',
    shortcut: 'K'
  },
  { id: 'note', label: 'Note', icon: StickyNote, command: 'tools.note', shortcut: 'N' },
  { id: 'text', label: 'Add text', icon: Type },
  { id: 'image', label: 'Add image', icon: Image },
  { id: 'shape', label: 'Add shape', icon: Square },
  { id: 'signature', label: 'Sign', icon: Signature }
]

/** The colour of the armed annotation tool (or of highlights, with Select). */
function ToolColor({ disabled }: { disabled: boolean }): React.JSX.Element {
  const activeTool = useTools((state) => state.activeTool)
  const colors = useTools((state) => state.colors)
  const setColor = useTools((state) => state.setColor)
  const tool: AnnotationTool =
    activeTool === 'note' || isMarkupTool(activeTool) ? activeTool : 'highlight'
  const current = colors[tool]
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label={`Colour for ${tool}`}
              aria-disabled={disabled || undefined}
              className="inline-flex h-8 w-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-accent"
            >
              <span
                className="size-3.5 rounded-full ring-1 ring-black/20"
                style={{ background: disabled ? 'transparent' : current }}
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Colour
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuLabel className="capitalize">{tool} colour</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => setColor(tool, value)}>
          {PALETTE.map((swatch) => (
            <DropdownMenuRadioItem key={swatch.value} value={swatch.value}>
              <span
                className="size-3.5 rounded-full ring-1 ring-black/20"
                style={{ background: swatch.value }}
                aria-hidden
              />
              {swatch.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
      <ToolbarButton
        icon={Save}
        label={tab?.history.modified ? 'Save' : 'Save (no unsaved changes)'}
        shortcut="Ctrl+S"
        disabled={none}
        onClick={() => runCommand('file.save')}
      />
      <ToolbarButton icon={Printer} label="Print" shortcut="Ctrl+P" disabled />
      <Divider className="max-xl:hidden" />
      <ToolbarButton
        icon={Undo2}
        label={tab?.history.undoName ? `Undo ${tab.history.undoName}` : 'Undo'}
        shortcut="Ctrl+Z"
        disabled={!tab?.history.canUndo}
        className="max-xl:hidden"
        onClick={() => runCommand('edit.undo')}
      />
      <ToolbarButton
        icon={Redo2}
        label={tab?.history.redoName ? `Redo ${tab.history.redoName}` : 'Redo'}
        shortcut="Ctrl+Y"
        disabled={!tab?.history.canRedo}
        className="max-xl:hidden"
        onClick={() => runCommand('edit.redo')}
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
        {TOOLS.map((tool) => {
          const command = tool.command
          return (
            <ToolbarButton
              key={tool.id}
              icon={tool.icon}
              label={tool.label}
              shortcut={tool.shortcut}
              disabled={none || command === undefined}
              active={!none && activeTool === tool.id}
              onClick={command ? () => runCommand(command) : undefined}
            />
          )
        })}
        <ToolColor disabled={none} />
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
