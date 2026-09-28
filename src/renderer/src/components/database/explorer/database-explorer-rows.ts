import { groupDatabaseConnections } from '../database-connection-groups'
import {
  connectionNode,
  isExpandableNode,
  type DatabaseExplorerNode
} from './database-explorer-tree'

export type DatabaseExplorerChildren =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; nodes: DatabaseExplorerNode[] }

/** A top-level entry: a connection, or a group of connections. */
export type DatabaseExplorerRoot =
  | DatabaseExplorerNode
  | { kind: 'group'; key: string; group: string; nodes: DatabaseExplorerNode[] }

/** Every row but a group's carries the group it sits in (null: top level), for drops. */
export type DatabaseExplorerRow =
  | { type: 'group'; key: string; group: string; count: number; depth: 0; expanded: boolean }
  | {
      type: 'node'
      key: string
      node: DatabaseExplorerNode
      depth: number
      expanded: boolean
      group: string | null
    }
  | {
      type: 'status'
      key: string
      depth: number
      group: string | null
      status: 'loading' | 'empty'
    }
  | {
      type: 'status'
      key: string
      depth: number
      group: string | null
      status: 'error'
      message: string
    }

export function groupRowKey(group: string): string {
  return `g:${encodeURIComponent(group)}`
}

export function databaseExplorerRoots(
  connections: readonly { id: string; group?: string | null }[]
): DatabaseExplorerRoot[] {
  const { groups, ungrouped } = groupDatabaseConnections(connections)
  return [
    ...groups.map((group): DatabaseExplorerRoot => ({
      kind: 'group',
      key: groupRowKey(group.name),
      group: group.name,
      nodes: group.connectionIds.map(connectionNode)
    })),
    ...ungrouped.map(connectionNode)
  ]
}

/** Depth-first rows for the visible part of the tree, with loading/error/empty placeholders. */
export function flattenDatabaseExplorer(
  roots: readonly DatabaseExplorerRoot[],
  expanded: Readonly<Record<string, boolean>>,
  children: Readonly<Record<string, DatabaseExplorerChildren>>,
  collapsedGroups: ReadonlySet<string> = new Set()
): DatabaseExplorerRow[] {
  const rows: DatabaseExplorerRow[] = []
  const visit = (node: DatabaseExplorerNode, depth: number, group: string | null): void => {
    const isExpanded = isExpandableNode(node) && expanded[node.key] === true
    rows.push({ type: 'node', key: node.key, node, depth, expanded: isExpanded, group })
    if (!isExpanded) {
      return
    }
    const loaded = children[node.key]
    const status = { type: 'status', key: `${node.key}#status`, depth: depth + 1, group } as const
    if (!loaded || loaded.status === 'loading') {
      rows.push({ ...status, status: 'loading' })
    } else if (loaded.status === 'error') {
      rows.push({ ...status, status: 'error', message: loaded.message })
    } else if (loaded.nodes.length === 0) {
      rows.push({ ...status, status: 'empty' })
    } else {
      loaded.nodes.forEach((child) => visit(child, depth + 1, group))
    }
  }
  for (const root of roots) {
    if (root.kind !== 'group') {
      visit(root, 0, null)
      continue
    }
    const isExpanded = !collapsedGroups.has(root.group)
    rows.push({
      type: 'group',
      key: root.key,
      group: root.group,
      count: root.nodes.length,
      depth: 0,
      expanded: isExpanded
    })
    if (isExpanded) {
      root.nodes.forEach((node) => visit(node, 1, root.group))
    }
  }
  return rows
}
