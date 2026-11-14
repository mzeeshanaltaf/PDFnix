import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Columns2,
  Combine,
  Eraser,
  EyeOff,
  File,
  FileCog,
  FileOutput,
  FilePlus2,
  Files,
  FolderOpen,
  Layers,
  LayoutGrid,
  ListRestart,
  PanelTop,
  Scissors,
  SquarePlus,
  Stamp,
  Hand,
  Highlighter,
  Image,
  Minus,
  MousePointer2,
  MoveHorizontal,
  MoveUpRight,
  PanelLeft,
  PenLine,
  Plus,
  Printer,
  Redo2,
  RotateCcw,
  RotateCw,
  Rows2,
  Save,
  Scan,
  Search,
  Settings2,
  Signature,
  Square,
  StickyNote,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from 'lucide-react'
import { isLayoutMode, type LayoutMode, type SignatureKind } from '../../../shared/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  armSignature,
  entriesOf,
  loadSignatures,
  previewUrl,
  useSignatures
} from '@/state/signatures'
import { selectActiveTab, useTabs } from '@/state/tabs'
import {
  isMarkupTool,
  PALETTE,
  useTools,
  type AnnotationTool,
  type ShapeTool as ShapeKind,
  type ToolId
} from '@/state/tools'
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
  { id: 'hand', label: 'Pan', icon: Hand, command: 'tools.hand' },
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
  { id: 'note', label: 'Note', icon: StickyNote, command: 'tools.note', shortcut: 'N' }
]

/** Tools that change the page itself; shapes and signing have their own menus. */
const CONTENT_TOOLS: typeof TOOLS = [
  { id: 'text', label: 'Add text', icon: Type, command: 'tools.text', shortcut: 'T' },
  {
    id: 'editText',
    label: 'Edit text',
    icon: TextCursorInput,
    command: 'tools.editText',
    shortcut: 'E'
  },
  { id: 'image', label: 'Add image', icon: Image, command: 'tools.image', shortcut: 'I' }
]

const AFTER_SHAPES: typeof TOOLS = [
  { id: 'draw', label: 'Draw', icon: PenLine, command: 'tools.draw', shortcut: 'D' },
  {
    id: 'deleteObject',
    label: 'Delete object',
    icon: Eraser,
    command: 'tools.deleteObject',
    shortcut: 'X'
  },
  {
    id: 'redact',
    label: 'Mark for redaction',
    icon: EyeOff,
    command: 'tools.redact',
    shortcut: 'R'
  }
]

/** Page and document tools (phase 5), in the Document menu on the toolbar. */
function DocumentMenu({ none }: { none: boolean }): React.JSX.Element {
  const item = (
    label: string,
    command: CommandId,
    Icon: LucideIcon,
    shortcut?: string
  ): React.JSX.Element => (
    <DropdownMenuItem
      disabled={none && command !== 'document.merge'}
      onSelect={() => runCommand(command)}
    >
      <Icon aria-hidden />
      {label}
      {shortcut && <span className="ml-auto text-xs text-muted-foreground">{shortcut}</span>}
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton icon={FileCog} label="Document tools" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Pages</DropdownMenuLabel>
        {item('Organise pages…', 'document.organise', LayoutGrid, 'Ctrl+Shift+O')}
        {item('Insert blank page', 'document.insertBlank', SquarePlus)}
        {item('Insert pages from file…', 'document.insertFromFile', FilePlus2)}
        {item('Extract pages…', 'document.extract', FileOutput)}
        {item('Split document…', 'document.split', Scissors)}
        {item('Merge files…', 'document.merge', Combine)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Content</DropdownMenuLabel>
        {item('Redact…', 'document.redact', EyeOff, 'Ctrl+Shift+X')}
        {item('Watermark…', 'document.watermark', Stamp)}
        {item('Header and footer…', 'document.headerFooter', PanelTop)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Form</DropdownMenuLabel>
        {item('Highlight form fields', 'forms.highlight', ClipboardList)}
        {item('Reset form…', 'forms.reset', ListRestart)}
        {item('Flatten form…', 'forms.flatten', Layers)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const SHAPES: { value: ShapeKind; label: string; icon: LucideIcon }[] = [
  { value: 'square', label: 'Rectangle', icon: Square },
  { value: 'circle', label: 'Ellipse', icon: Circle },
  { value: 'line', label: 'Line', icon: Minus },
  { value: 'arrow', label: 'Arrow', icon: MoveUpRight }
]

function ToolButtons({ tools, none }: { tools: typeof TOOLS; none: boolean }): React.JSX.Element {
  const activeTool = useTools((state) => state.activeTool)
  return (
    <>
      {tools.map((tool) => {
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
    </>
  )
}

/** The shape tool, with the kind of shape in a drop-down beside it. */
function ShapeTool({ none }: { none: boolean }): React.JSX.Element {
  const activeTool = useTools((state) => state.activeTool)
  const kind = useTools((state) => state.shape.kind)
  const current = SHAPES.find((shape) => shape.value === kind) ?? SHAPES[0]
  return (
    <>
      <ToolbarButton
        icon={current.icon}
        label={`Shapes: ${current.label}`}
        shortcut="S"
        disabled={none}
        active={!none && activeTool === 'shape'}
        onClick={() => runCommand('tools.shape')}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={none}>
          <ToolbarButton icon={ChevronDown} label="Choose shape" compact disabled={none} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuRadioGroup
            value={kind}
            onValueChange={(value) => {
              useTools.getState().setShape({ kind: value as ShapeKind })
              useTools.getState().setActiveTool('shape')
            }}
          >
            {SHAPES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon className="size-4" aria-hidden />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

function SignatureItems({ kind }: { kind: SignatureKind }): React.JSX.Element | null {
  const entries = useSignatures((state) => state.entries)
  const own = entriesOf(entries, kind)
  if (own.length === 0) return null
  return (
    <>
      {own.map((entry) => (
        <DropdownMenuItem
          key={entry.id}
          onSelect={() => void armSignature(kind, { entryId: entry.id })}
        >
          <img
            src={previewUrl(entry)}
            alt=""
            className="h-7 w-24 rounded-sm bg-white object-contain"
          />
          <span className="truncate">{entry.name}</span>
          {entry.isDefault && (
            <span className="ml-auto text-[11px] text-muted-foreground">Default</span>
          )}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/** The Sign menu: pick a signature or initials, create them, initial every page. */
function SignMenu({ none }: { none: boolean }): React.JSX.Element {
  const activeTool = useTools((state) => state.activeTool)
  return (
    <DropdownMenu onOpenChange={(open) => open && void loadSignatures()}>
      <DropdownMenuTrigger asChild disabled={none}>
        <ToolbarButton
          icon={Signature}
          label="Sign"
          disabled={none}
          active={!none && activeTool === 'signature'}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Signatures</DropdownMenuLabel>
        <SignatureItems kind="signature" />
        <DropdownMenuItem onSelect={() => useSignatures.getState().showDialog('signature')}>
          <Plus aria-hidden />
          Create signature…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Initials</DropdownMenuLabel>
        <SignatureItems kind="initials" />
        <DropdownMenuItem onSelect={() => useSignatures.getState().showDialog('initials')}>
          <Plus aria-hidden />
          Create initials…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runCommand('tools.initialsAllPages')}>
          <Files aria-hidden />
          Place initials on every page…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => runCommand('tools.manageSignatures')}>
          <Settings2 aria-hidden />
          Manage signatures and initials…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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

/** On narrow windows: every tool, including signing, in one menu. */
function CompactEditTools({ none }: { none: boolean }): React.JSX.Element {
  const activeTool = useTools((state) => state.activeTool)
  const all = [...TOOLS, ...CONTENT_TOOLS, ...AFTER_SHAPES]
  const current = [...all, { id: 'shape' as ToolId, icon: Square, label: 'Shapes' }].find(
    (tool) => tool.id === activeTool && tool.id !== 'select'
  )
  return (
    <DropdownMenu onOpenChange={(open) => open && void loadSignatures()}>
      <DropdownMenuTrigger asChild disabled={none}>
        <ToolbarButton
          icon={current?.icon ?? PenLine}
          label={current ? `Tools: ${current.label}` : 'Tools'}
          disabled={none}
          active={!none && current !== undefined}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {all.map((tool) => (
          <DropdownMenuItem
            key={tool.id}
            disabled={!tool.command}
            onSelect={() => tool.command && runCommand(tool.command)}
          >
            <tool.icon aria-hidden />
            {tool.label}
            {tool.shortcut && (
              <span className="ml-auto text-xs text-muted-foreground">{tool.shortcut}</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {SHAPES.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => {
              useTools.getState().setShape({ kind: value })
              useTools.getState().setActiveTool('shape')
            }}
          >
            <Icon aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => runCommand('tools.sign')}>
          <Signature aria-hidden />
          Sign
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runCommand('tools.initials')}>
          <Signature aria-hidden />
          Initials
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runCommand('tools.initialsAllPages')}>
          <Files aria-hidden />
          Initials on every page…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => runCommand('tools.manageSignatures')}>
          <Settings2 aria-hidden />
          Signatures and initials…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The top toolbar. Everything on it acts on the active tab. */
export function Toolbar(): React.JSX.Element {
  const tab = useTabs(selectActiveTab)
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
      <ToolbarButton
        icon={Printer}
        label="Print"
        shortcut="Ctrl+P"
        disabled={none}
        onClick={() => runCommand('file.print')}
      />
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
        <ToolButtons tools={TOOLS} none={none} />
        <ToolColor disabled={none} />
      </div>
      <Divider className="max-[1400px]:hidden" />
      <div className="flex items-center gap-0.5 max-[1400px]:hidden">
        <ToolButtons tools={CONTENT_TOOLS} none={none} />
        <ShapeTool none={none} />
        <ToolButtons tools={AFTER_SHAPES} none={none} />
        <SignMenu none={none} />
      </div>
      <div className="flex items-center gap-0.5 min-[1401px]:hidden">
        <Divider />
        <CompactEditTools none={none} />
      </div>

      <div className="flex-1" />
      <DocumentMenu none={none} />
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
