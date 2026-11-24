/**
 * The selection menu's logic, kept apart from its component so it can be
 * tested: where the menu goes, the sections other features add to it, and
 * whether it is open.
 */

import type { LucideIcon } from 'lucide-react'
import { create } from 'zustand'
import type { WordPiece } from './quads'

/** A box in window (CSS pixel) coordinates, like a `DOMRect`. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Size {
  width: number
  height: number
}

/**
 * What the menu is placed against: the client rects of the selected text
 * (it opens below them), or the pointer of a right-click (it opens there).
 */
export type MenuAnchor = { rects: readonly Box[] } | { point: { x: number; y: number } }

/** Gap between the selection and the menu. */
const GAP = 8
/** Distance kept from the window's left, right and top edges. */
const EDGE = 8
/** Distance kept from the window's bottom, which the status bar occupies. */
const BOTTOM = 40

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high))
}

/**
 * Top-left corner of a menu of `size` for `anchor`, in window coordinates.
 * Against a selection it goes below the selection's last line, centred on
 * that line's end, or above the first line when there is no room below.
 * At a pointer its corner is at the pointer. Either way it stays inside the
 * window. Null for a selection without rects.
 */
export function menuPlacement(
  anchor: MenuAnchor,
  size: Size,
  viewport: Size
): { left: number; top: number } | null {
  const maxLeft = viewport.width - size.width - EDGE
  const maxTop = viewport.height - size.height - BOTTOM
  if ('point' in anchor) {
    return {
      left: Math.max(EDGE, Math.min(anchor.point.x, maxLeft)),
      top: Math.max(EDGE, Math.min(anchor.point.y, maxTop))
    }
  }
  const rects = anchor.rects
  const first = rects[0]
  const last = rects[rects.length - 1]
  if (!first || !last) return null
  const left = clamp(last.right - size.width / 2, EDGE, maxLeft)
  const below = last.bottom + GAP
  const top = below + size.height > viewport.height - BOTTOM ? first.top - size.height - GAP : below
  return { left, top: Math.max(EDGE, top) }
}

/** What a section's item gets when it is chosen: the selection as it was. */
export interface SelectionContext {
  tabId: string
  /** The selected text, with line breaks between lines. */
  text: string
  /** The (0-based) page the selection starts on. */
  page: number
  pieces: WordPiece[]
}

export interface SelectionMenuItem {
  id: string
  label: string
  icon: LucideIcon
  run: (context: SelectionContext) => void | Promise<void>
}

/** A group of items another feature adds to the menu, below Copy and Edit text. */
export interface SelectionMenuSection {
  id: string
  /** Name of the group for screen readers ("AI Assistant"); the id if left out. */
  label?: string
  items: SelectionMenuItem[]
  /** One muted line under the items ("Runs on this computer with LM Studio"). */
  note?: string
}

let sections: readonly SelectionMenuSection[] = []
const sectionListeners = new Set<() => void>()

/**
 * Adds a section to the selection menu (or replaces the one with the same
 * id). Returns a function that removes it again.
 */
export function registerSelectionMenuSection(section: SelectionMenuSection): () => void {
  sections = [...sections.filter((existing) => existing.id !== section.id), section]
  for (const listener of [...sectionListeners]) listener()
  return () => {
    if (!sections.includes(section)) return
    sections = sections.filter((existing) => existing !== section)
    for (const listener of [...sectionListeners]) listener()
  }
}

/** The sections to draw: those with at least one item, in the order they were added. */
export function selectionMenuSections(): readonly SelectionMenuSection[] {
  return sections.filter((section) => section.items.length > 0)
}

/** Calls `listener` whenever the sections change. Returns the undo. */
export function subscribeSelectionMenuSections(listener: () => void): () => void {
  sectionListeners.add(listener)
  return () => {
    sectionListeners.delete(listener)
  }
}

/** Raw list, for `useSyncExternalStore` (stable between changes). */
export function selectionMenuSectionsSnapshot(): readonly SelectionMenuSection[] {
  return sections
}

interface SelectionMenuState {
  anchor: MenuAnchor | null
  show: (anchor: MenuAnchor) => void
  hide: () => void
}

/** Whether the menu is open, and what it is placed against. */
export const useSelectionMenu = create<SelectionMenuState>((set) => ({
  anchor: null,
  show: (anchor) => set({ anchor }),
  hide: () => set({ anchor: null })
}))

/** Opens the menu with its corner at a pointer (right-click on selected text). */
export function openSelectionMenuAt(x: number, y: number): void {
  useSelectionMenu.getState().show({ point: { x, y } })
}
