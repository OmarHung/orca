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
  /** One of a server's databases, when the connection lists them all. */
  | { kind: 'database'; key: string; connectionId: string; database: string }
  | { kind: 'schema'; key: string; connectionId: string; database: string | null; schema: string }
  | {
      kind: 'relation'
      key: string
      connectionId: string
      /** Null is the connection's own database. */
      database: string | null
      schema: string
      relation: DatabaseRelationInfo
    }
  | {
      kind: 'column'
      key: string
      connectionId: string
      /** Null is the connection's own database. */
      database: string | null
      schema: string
      relationName: string
      column: DatabaseColumnInfo
    }
  | {
      kind: 'folder'
      key: string
      connectionId: string
      /** Null is the connection's own database. */
      database: string | null
      schema: string
      folder: DatabaseExplorerFolder
      /** The table a Keys or Indexes folder belongs to; null for a schema's Routines. */
      relationName: string | null
    }
  | {
      kind: 'routine'
      key: string
      connectionId: string
      /** Null is the connection's own database. */
      database: string | null
      schema: string
      routine: DatabaseRoutineInfo
    }
  | {
      kind: 'constraint'
      key: string
      connectionId: string
      /** Null is the connection's own database. */
      database: string | null
      schema: string
      relationName: string
      constraint: DatabaseKeyInfo
    }
  | {
      kind: 'index'
      key: string
      connectionId: string
      /** Null is the connection's own database. */
      database: string | null
      schema: string
      relationName: string
      index: DatabaseIndexInfo
    }

/** What the explorer knows beyond the answer itself, e.g. SQLite has no routines. */
export type DatabaseExplorerChildOptions = {
  routines: boolean
  /** A PostgreSQL or SQL Server connection with no database lists all of the server's. */
  allDatabases?: boolean
}

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

type InDatabase = { database: string | null }

const inDatabase = ({ database }: InDatabase): { database?: string } =>
  database === null ? {} : { database }

function folderNode(
  parent: DatabaseExplorerNode & InDatabase & { schema: string },
  folder: DatabaseExplorerFolder,
  relationName: string | null
): DatabaseExplorerNode {
  return {
    kind: 'folder',
    key: `${parent.key}/${segment('f', folder)}`,
    connectionId: parent.connectionId,
    database: parent.database,
    schema: parent.schema,
    folder,
    relationName
  }
}

export function introspectTargetFor(
  node: DatabaseExplorerNode,
  options: Pick<DatabaseExplorerChildOptions, 'allDatabases'> = {}
): DatabaseIntrospectTarget | null {
  switch (node.kind) {
    case 'connection':
      return options.allDatabases ? { level: 'databases' } : { level: 'schemas' }
    case 'database':
      return { level: 'schemas', database: node.database }
    case 'schema':
      return { level: 'relations', ...inDatabase(node), schema: node.schema }
    case 'relation':
      return {
        level: 'columns',
        ...inDatabase(node),
        schema: node.schema,
        relation: node.relation.name
      }
    case 'folder':
      return node.folder === 'routines' || node.relationName === null
        ? { level: 'routines', ...inDatabase(node), schema: node.schema }
        : {
            level: node.folder,
            ...inDatabase(node),
            schema: node.schema,
            relation: node.relationName
          }
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
    case 'databases':
      return result.databases.map((database) => ({
        kind: 'database',
        key: `${parent.key}/${segment('d', database.name)}`,
        connectionId,
        database: database.name
      }))
    case 'schemas':
      return result.schemas.map((schema) => ({
        kind: 'schema',
        key: `${parent.key}/${segment('s', schema.name)}`,
        connectionId,
        database: parent.kind === 'database' ? parent.database : null,
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
          database: parent.database,
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
          database: parent.database,
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
            database: parent.database,
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
            database: parent.database,
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
            database: parent.database,
            schema: parent.schema,
            relationName: parent.relationName ?? '',
            index
          }))
        : []
  }
}
