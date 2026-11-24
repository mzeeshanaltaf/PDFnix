/**
 * The selection menu's AI Assistant section: Simplify, Define and Ask AI
 * Assistant. The answers appear in the AI Assistant side panel.
 */

import { BookOpenText, ListCollapse, Sparkles } from 'lucide-react'
import { askAssistant, focusAssistantInput, setPendingQuote } from '@/state/assistant'
import { setSidePanel } from '@/shell/commands'
import { registerSelectionMenuSection, type SelectionContext } from './selectionMenuState'

function ask(action: 'simplify' | 'define') {
  return ({ tabId, text, page }: SelectionContext): void => {
    setSidePanel(tabId, true, 'assistant')
    void askAssistant(tabId, { action, selection: text, page })
  }
}

/** Opens the panel with the selection quoted in its input, ready for a question. */
export function quoteInAssistant({ tabId, text, page }: SelectionContext): void {
  setSidePanel(tabId, true, 'assistant')
  setPendingQuote(tabId, { text, page })
  focusAssistantInput()
}

/** Adds the section to the selection menu. Returns the undo. */
export function installAssistantMenu(): () => void {
  return registerSelectionMenuSection({
    id: 'assistant',
    label: 'AI Assistant',
    items: [
      { id: 'simplify', label: 'Simplify', icon: ListCollapse, run: ask('simplify') },
      { id: 'define', label: 'Define', icon: BookOpenText, run: ask('define') },
      { id: 'ask', label: 'Ask AI Assistant', icon: Sparkles, run: quoteInAssistant }
    ],
    note: 'Runs on this computer with LM Studio'
  })
}
