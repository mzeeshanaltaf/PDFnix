import { create } from 'zustand'
import type { FontFamily, MarkupType, TextAlign } from '../api/engine'

/** The tools on the toolbar. */
export type ToolId =
  | 'select'
  | 'hand'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  /** Add a text box (free text annotation). */
  | 'text'
  /** Edit the page's own text. */
  | 'editText'
  | 'image'
  | 'shape'
  | 'draw'
  /** Delete text or an image from the page content. */
  | 'deleteObject'
  /** Place the chosen signature or initials. */
  | 'signature'

/** Tools that create an annotation, and so have a colour. */
export type AnnotationTool = MarkupType | 'note'

export const MARKUP_TOOLS: readonly MarkupType[] = ['highlight', 'underline', 'strikeout']

export function isMarkupTool(tool: ToolId): tool is MarkupType {
  return (MARKUP_TOOLS as readonly string[]).includes(tool)
}

/**
 * Tools that take over the page: pressing on it creates or picks something
 * instead of selecting text.
 */
export const EDIT_TOOLS: readonly ToolId[] = [
  'text',
  'editText',
  'image',
  'shape',
  'draw',
  'deleteObject',
  'signature',
  'hand'
]

export function isEditTool(tool: ToolId): boolean {
  return EDIT_TOOLS.includes(tool)
}

/** The colours offered for annotations. */
export const PALETTE: readonly { value: string; label: string }[] = [
  { value: '#ffd54f', label: 'Yellow' },
  { value: '#aed581', label: 'Green' },
  { value: '#4fc3f7', label: 'Blue' },
  { value: '#f48fb1', label: 'Pink' },
  { value: '#ffb74d', label: 'Orange' },
  { value: '#e53935', label: 'Red' },
  { value: '#1e88e5', label: 'Dark blue' },
  { value: '#212121', label: 'Black' }
]

/** Colours for text, shapes and drawing: the palette with plain black first. */
export const INK_PALETTE: readonly { value: string; label: string }[] = [
  { value: '#000000', label: 'Black' },
  { value: '#e53935', label: 'Red' },
  { value: '#1e88e5', label: 'Blue' },
  { value: '#2e7d32', label: 'Green' },
  { value: '#fb8c00', label: 'Orange' },
  { value: '#8e24aa', label: 'Purple' },
  { value: '#757575', label: 'Grey' },
  { value: '#ffffff', label: 'White' }
]

export const DEFAULT_COLORS: Record<AnnotationTool, string> = {
  highlight: '#ffd54f',
  underline: '#1e88e5',
  strikeout: '#e53935',
  note: '#ffd54f'
}

export type ShapeTool = 'square' | 'circle' | 'line' | 'arrow'

export interface TextOptions {
  fontFamily: FontFamily
  fontSize: number
  color: string
  bold: boolean
  italic: boolean
  align: TextAlign
}

export interface ShapeOptions {
  kind: ShapeTool
  color: string
  /** Null: no fill. */
  fill: string | null
  width: number
  opacity: number
}

export interface PenOptions {
  color: string
  width: number
  opacity: number
}

export const DEFAULT_TEXT: TextOptions = {
  fontFamily: 'sans',
  fontSize: 12,
  color: '#000000',
  bold: false,
  italic: false,
  align: 'left'
}

export const DEFAULT_SHAPE: ShapeOptions = {
  kind: 'square',
  color: '#e53935',
  fill: null,
  width: 2,
  opacity: 1
}

export const DEFAULT_PEN: PenOptions = { color: '#1e88e5', width: 2, opacity: 1 }

/** An annotation whose comment is being edited in its pop-up. */
export interface CommentEditor {
  tabId: string
  annotId: number
  page: number
}

interface ToolsState {
  activeTool: ToolId
  colors: Record<AnnotationTool, string>
  editing: CommentEditor | null
  text: TextOptions
  shape: ShapeOptions
  pen: PenOptions
  setActiveTool: (tool: ToolId) => void
  setColor: (tool: AnnotationTool, color: string) => void
  setEditing: (editing: CommentEditor | null) => void
  setText: (patch: Partial<TextOptions>) => void
  setShape: (patch: Partial<ShapeOptions>) => void
  setPen: (patch: Partial<PenOptions>) => void
}

export const useTools = create<ToolsState>((set) => ({
  activeTool: 'select',
  colors: DEFAULT_COLORS,
  editing: null,
  text: DEFAULT_TEXT,
  shape: DEFAULT_SHAPE,
  pen: DEFAULT_PEN,
  setActiveTool: (tool) => set({ activeTool: tool }),
  setColor: (tool, color) => set((state) => ({ colors: { ...state.colors, [tool]: color } })),
  setEditing: (editing) => set({ editing }),
  setText: (patch) => set((state) => ({ text: { ...state.text, ...patch } })),
  setShape: (patch) => set((state) => ({ shape: { ...state.shape, ...patch } })),
  setPen: (patch) => set((state) => ({ pen: { ...state.pen, ...patch } }))
}))
