import type {
  DatabaseColumnInfo,
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget,
  DatabaseRelationInfo
} from '../../../../../shared/database/database-introspection-types'

export type DatabaseExplorerNode =
  | { kind: 'connection'; key: string; connectionId: string }
  | { kind: 'schema'; key: string; connectionId: string; schema: string }
  | {
      kind: 'relation'
      key: string
      connectionId: string
      schema: string
      relation: DatabaseRelationInfo
    }
  | {
      kind: 'column'
      key: string
      connectionId: string
      schema: string
      relationName: string
      column: DatabaseColumnInfo
    }

export type DatabaseExplorerChildren =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; nodes: DatabaseExplorerNode[] }

export type DatabaseExplorerRow =
  | { type: 'node'; key: string; node: DatabaseExplorerNode; depth: number; expanded: boolean }
  | { type: 'status'; key: string; depth: number; status: 'loading' | 'empty' }
  | { type: 'status'; key: string; depth: number; status: 'error'; message: string }

// Why encodeURIComponent: object names may contain "/", which would collide keys.
const segment = (prefix: string, name: string): string => `${prefix}:${encodeURIComponent(name)}`

export function connectionNodeKey(connectionId: string): string {
  return segment('c', connectionId)
}

export function connectionNode(connectionId: string): DatabaseExplorerNode {
  return { kind: 'connection', key: connectionNodeKey(connectionId), connectionId }
}

export function isExpandableNode(node: DatabaseExplorerNode): boolean {
  return node.kind !== 'column'
}

export function introspectTargetFor(node: DatabaseExplorerNode): DatabaseIntrospectTarget | null {
  switch (node.kind) {
    case 'connection':
      return { level: 'schemas' }
    case 'schema':
      return { level: 'relations', schema: node.schema }
    case 'relation':
      return { level: 'columns', schema: node.schema, relation: node.relation.name }
    case 'column':
      return null
  }
}

/** Turns one introspection answer into the child nodes of `parent`. */
export function childNodesFor(
  parent: DatabaseExplorerNode,
  result: DatabaseIntrospectResult
): DatabaseExplorerNode[] {
  const { connectionId } = parent
  switch (result.level) {
    case 'schemas':
      return result.schemas.map((schema) => ({
        kind: 'schema',
        key: `${parent.key}/${segment('s', schema.name)}`,
        connectionId,
        schema: schema.name
      }))
    case 'relations':
      return parent.kind === 'schema'
        ? result.relations.map((relation) => ({
            kind: 'relation',
            key: `${parent.key}/${segment('r', relation.name)}`,
            connectionId,
            schema: parent.schema,
            relation
          }))
        : []
    case 'columns':
      return parent.kind === 'relation'
        ? result.columns.map((column) => ({
            kind: 'column',
            key: `${parent.key}/${segment('col', column.name)}`,
            connectionId,
            schema: parent.schema,
            relationName: parent.relation.name,
            column
          }))
        : []
  }
}

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

export function qualifiedRelationName(schema: string, relation: string): string {
  const quote = (name: string): string =>
    /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`
  return `${quote(schema)}.${quote(relation)}`
}
