import { create } from 'zustand'
import type { MarkupType } from '../api/engine'

/** The tools on the toolbar. Text, image, shape and signature arrive in phase 4. */
export type ToolId =
  | 'select'
  | 'hand'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'text'
  | 'image'
  | 'shape'
  | 'signature'

/** Tools that create an annotation, and so have a colour. */
export type AnnotationTool = MarkupType | 'note'

export const MARKUP_TOOLS: readonly MarkupType[] = ['highlight', 'underline', 'strikeout']

export function isMarkupTool(tool: ToolId): tool is MarkupType {
  return (MARKUP_TOOLS as readonly string[]).includes(tool)
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

export const DEFAULT_COLORS: Record<AnnotationTool, string> = {
  highlight: '#ffd54f',
  underline: '#1e88e5',
  strikeout: '#e53935',
  note: '#ffd54f'
}

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
  setActiveTool: (tool: ToolId) => void
  setColor: (tool: AnnotationTool, color: string) => void
  setEditing: (editing: CommentEditor | null) => void
}

export const useTools = create<ToolsState>((set) => ({
  activeTool: 'select',
  colors: DEFAULT_COLORS,
  editing: null,
  setActiveTool: (tool) => set({ activeTool: tool }),
  setColor: (tool, color) => set((state) => ({ colors: { ...state.colors, [tool]: color } })),
  setEditing: (editing) => set({ editing })
}))
