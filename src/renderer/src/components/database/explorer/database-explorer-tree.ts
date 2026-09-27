import type {
  DatabaseColumnInfo,
  DatabaseIndexInfo,
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget,
  DatabaseKeyInfo,
  DatabaseRelationInfo,
  DatabaseRoutineInfo
} from '../../../../../shared/database/database-introspection-types'

export type DatabaseExplorerFolder = 'routines' | 'keys' | 'indexes'

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
  | {
      kind: 'folder'
      key: string
      connectionId: string
      schema: string
      folder: DatabaseExplorerFolder
      /** The table a Keys or Indexes folder belongs to; null for a schema's Routines. */
      relationName: string | null
    }
  | {
      kind: 'routine'
      key: string
      connectionId: string
      schema: string
      routine: DatabaseRoutineInfo
    }
  | {
      kind: 'constraint'
      key: string
      connectionId: string
      schema: string
      relationName: string
      constraint: DatabaseKeyInfo
    }
  | {
      kind: 'index'
      key: string
      connectionId: string
      schema: string
      relationName: string
      index: DatabaseIndexInfo
    }

/** What the explorer knows beyond the answer itself, e.g. SQLite has no routines. */
export type DatabaseExplorerChildOptions = { routines: boolean }

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

const LEAF_KINDS = new Set<DatabaseExplorerNode['kind']>([
  'column',
  'routine',
  'constraint',
  'index'
])

export function isExpandableNode(node: DatabaseExplorerNode): boolean {
  return !LEAF_KINDS.has(node.kind)
}

// Keys and indexes belong to tables; a materialized view can be indexed but has no keys.
const RELATION_FOLDERS: Record<DatabaseRelationInfo['kind'], DatabaseExplorerFolder[]> = {
  table: ['keys', 'indexes'],
  'partitioned-table': ['keys', 'indexes'],
  'materialized-view': ['indexes'],
  view: [],
  'foreign-table': []
}

function folderNode(
  parent: DatabaseExplorerNode & { schema: string },
  folder: DatabaseExplorerFolder,
  relationName: string | null
): DatabaseExplorerNode {
  return {
    kind: 'folder',
    key: `${parent.key}/${segment('f', folder)}`,
    connectionId: parent.connectionId,
    schema: parent.schema,
    folder,
    relationName
  }
}

export function introspectTargetFor(node: DatabaseExplorerNode): DatabaseIntrospectTarget | null {
  switch (node.kind) {
    case 'connection':
      return { level: 'schemas' }
    case 'schema':
      return { level: 'relations', schema: node.schema }
    case 'relation':
      return { level: 'columns', schema: node.schema, relation: node.relation.name }
    case 'folder':
      return node.folder === 'routines' || node.relationName === null
        ? { level: 'routines', schema: node.schema }
        : { level: node.folder, schema: node.schema, relation: node.relationName }
    case 'column':
    case 'routine':
    case 'constraint':
    case 'index':
      return null
  }
}

/** Turns one introspection answer into the child nodes of `parent`. */
export function childNodesFor(
  parent: DatabaseExplorerNode,
  result: DatabaseIntrospectResult,
  options: DatabaseExplorerChildOptions = { routines: true }
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
      if (parent.kind !== 'schema') {
        return []
      }
      return [
        ...result.relations.map((relation): DatabaseExplorerNode => ({
          kind: 'relation',
          key: `${parent.key}/${segment('r', relation.name)}`,
          connectionId,
          schema: parent.schema,
          relation
        })),
        ...(options.routines ? [folderNode(parent, 'routines', null)] : [])
      ]
    case 'columns':
      if (parent.kind !== 'relation') {
        return []
      }
      return [
        ...result.columns.map((column): DatabaseExplorerNode => ({
          kind: 'column',
          key: `${parent.key}/${segment('col', column.name)}`,
          connectionId,
          schema: parent.schema,
          relationName: parent.relation.name,
          column
        })),
        ...RELATION_FOLDERS[parent.relation.kind].map((folder) =>
          folderNode(parent, folder, parent.relation.name)
        )
      ]
    case 'routines':
      return parent.kind === 'folder'
        ? result.routines.map((routine) => ({
            kind: 'routine',
            key: `${parent.key}/${segment('fn', routine.identity)}`,
            connectionId,
            schema: parent.schema,
            routine
          }))
        : []
    // Why the position in keys: SQLite's keys are unnamed.
    case 'keys':
      return parent.kind === 'folder' && parent.relationName !== null
        ? result.keys.map((constraint, position) => ({
            kind: 'constraint',
            key: `${parent.key}/${segment('k', `${position}:${constraint.name}`)}`,
            connectionId,
            schema: parent.schema,
            relationName: parent.relationName ?? '',
            constraint
          }))
        : []
    case 'indexes':
      return parent.kind === 'folder' && parent.relationName !== null
        ? result.indexes.map((index) => ({
            kind: 'index',
            key: `${parent.key}/${segment('i', index.name)}`,
            connectionId,
            schema: parent.schema,
            relationName: parent.relationName ?? '',
            index
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
