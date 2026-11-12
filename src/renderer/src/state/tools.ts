import { create } from 'zustand'

/** The tools on the toolbar. Their behaviour arrives in phases 2 to 4. */
export type ToolId =
  'select' | 'hand' | 'highlight' | 'comment' | 'text' | 'image' | 'shape' | 'signature'

interface ToolsState {
  activeTool: ToolId
  setActiveTool: (tool: ToolId) => void
}

export const useTools = create<ToolsState>((set) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool })
}))
