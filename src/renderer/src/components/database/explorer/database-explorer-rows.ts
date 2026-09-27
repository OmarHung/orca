import { isExpandableNode, type DatabaseExplorerNode } from './database-explorer-tree'

export type DatabaseExplorerChildren =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; nodes: DatabaseExplorerNode[] }

export type DatabaseExplorerRow =
  | { type: 'node'; key: string; node: DatabaseExplorerNode; depth: number; expanded: boolean }
  | { type: 'status'; key: string; depth: number; status: 'loading' | 'empty' }
  | { type: 'status'; key: string; depth: number; status: 'error'; message: string }

/** Depth-first rows for the visible part of the tree, with loading/error/empty placeholders. */
export function flattenDatabaseExplorer(
  roots: readonly DatabaseExplorerNode[],
  expanded: Readonly<Record<string, boolean>>,
  children: Readonly<Record<string, DatabaseExplorerChildren>>
): DatabaseExplorerRow[] {
  const rows: DatabaseExplorerRow[] = []
  const visit = (node: DatabaseExplorerNode, depth: number): void => {
    const isExpanded = isExpandableNode(node) && expanded[node.key] === true
    rows.push({ type: 'node', key: node.key, node, depth, expanded: isExpanded })
    if (!isExpanded) {
      return
    }
    const loaded = children[node.key]
    const statusKey = `${node.key}#status`
    if (!loaded || loaded.status === 'loading') {
      rows.push({ type: 'status', key: statusKey, depth: depth + 1, status: 'loading' })
    } else if (loaded.status === 'error') {
      rows.push({
        type: 'status',
        key: statusKey,
        depth: depth + 1,
        status: 'error',
        message: loaded.message
      })
    } else if (loaded.nodes.length === 0) {
      rows.push({ type: 'status', key: statusKey, depth: depth + 1, status: 'empty' })
    } else {
      loaded.nodes.forEach((child) => visit(child, depth + 1))
    }
  }
  roots.forEach((root) => visit(root, 0))
  return rows
}
