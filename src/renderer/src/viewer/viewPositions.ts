import type { Anchor } from './layout'

/**
 * Where each tab's view was last, so a tab is shown where it was left. Kept
 * outside React state because it changes with every scroll event.
 */
const positions = new Map<string, Anchor>()

export function rememberViewPosition(tabId: string, anchor: Anchor): void {
  positions.set(tabId, anchor)
}

export function recallViewPosition(tabId: string): Anchor | null {
  return positions.get(tabId) ?? null
}

export function forgetViewPosition(tabId: string): void {
  positions.delete(tabId)
}
