import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from 'cn'
import type { DocumentTab } from '@/state/tabs'
import { getViewer } from '@/viewer/controller'
import { buildOutlineTree, currentOutlineEntry, type OutlineNode } from './outlineTree'

interface OutlineItemProps {
  node: OutlineNode
  depth: number
  currentId: number | null
  collapsed: ReadonlySet<number>
  onToggle: (id: number) => void
  onOpen: (node: OutlineNode) => void
}

function OutlineItem({
  node,
  depth,
  currentId,
  collapsed,
  onToggle,
  onOpen
}: OutlineItemProps): React.JSX.Element {
  const hasChildren = node.children.length > 0
  const open = hasChildren && !collapsed.has(node.id)

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-level={depth + 1}>
      <div
        className={cn(
          'flex items-start rounded-sm pr-1 text-[13px] leading-5',
          node.id === currentId ? 'bg-primary/12 text-primary' : 'hover:bg-accent'
        )}
        style={{ paddingLeft: depth * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => onToggle(node.id)}
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <button
          type="button"
          disabled={node.page === null}
          onClick={() => onOpen(node)}
          title={node.title}
          className="min-w-0 flex-1 py-0.5 text-left outline-none focus-visible:underline disabled:text-muted-foreground"
        >
          <span className="line-clamp-2 break-words">{node.title || 'Untitled'}</span>
        </button>
        {node.page !== null && (
          <span className="mt-0.5 ml-2 shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {node.page + 1}
          </span>
        )}
      </div>
      {open && (
        <ul role="group">
          {node.children.map((child) => (
            <OutlineItem
              key={child.id}
              node={child}
              depth={depth + 1}
              currentId={currentId}
              collapsed={collapsed}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** The document's table of contents as a collapsible tree. */
export function Outline({ tab }: { tab: DocumentTab }): React.JSX.Element {
  const entries = tab.outline
  const tree = useMemo(() => buildOutlineTree(entries ?? []), [entries])
  // Only the top level is shown at first; a lone top-level entry (often the
  // document title) is opened so there is something to choose from.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const collapsed = useMemo(() => {
    const result = new Set<number>()
    const visit = (nodes: readonly OutlineNode[]): void => {
      for (const node of nodes) {
        const autoOpen = tree.length === 1 && node === tree[0]
        if (node.children.length > 0 && expanded.has(node.id) === autoOpen) result.add(node.id)
        visit(node.children)
      }
    }
    visit(tree)
    return result
  }, [tree, expanded])

  const currentId = useMemo(() => currentOutlineEntry(entries ?? [], tab.page), [entries, tab.page])

  // Toggling records a deviation from the default state of the node.
  const toggle = (id: number): void =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (entries === null) {
    return <p className="px-3 py-4 text-[13px] text-muted-foreground">Loading…</p>
  }
  if (tree.length === 0) {
    return (
      <p className="px-3 py-4 text-[13px] leading-relaxed text-muted-foreground">
        This document has no outline.
      </p>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      <ul role="tree" aria-label="Document outline">
        {tree.map((node) => (
          <OutlineItem
            key={node.id}
            node={node}
            depth={0}
            currentId={currentId}
            collapsed={collapsed}
            onToggle={toggle}
            onOpen={(target) => {
              if (target.page !== null) getViewer(tab.id)?.goToPage(target.page)
            }}
          />
        ))}
      </ul>
    </div>
  )
}
