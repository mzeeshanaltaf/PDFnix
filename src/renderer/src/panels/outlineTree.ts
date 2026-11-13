import type { OutlineEntry } from '@/api/engine'

export interface OutlineNode {
  /** Position in the flat list; identifies the entry. */
  id: number
  title: string
  page: number | null
  children: OutlineNode[]
}

/** Builds the tree from the flat list the engine returns (entries with levels). */
export function buildOutlineTree(entries: readonly OutlineEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  // The most recent node at each level, starting with level 1 at index 0.
  const path: OutlineNode[] = []
  entries.forEach((entry, id) => {
    const node: OutlineNode = { id, title: entry.title, page: entry.page, children: [] }
    // A level may skip ahead (1 then 3); attach to the deepest node there is.
    const depth = Math.min(Math.max(entry.level, 1) - 1, path.length)
    if (depth === 0) roots.push(node)
    else path[depth - 1].children.push(node)
    path.length = depth
    path.push(node)
  })
  return roots
}

/** The entry being read: the last one that starts on or before `page`. */
export function currentOutlineEntry(entries: readonly OutlineEntry[], page: number): number | null {
  let found: number | null = null
  entries.forEach((entry, id) => {
    if (entry.page !== null && entry.page <= page) found = id
  })
  return found
}
