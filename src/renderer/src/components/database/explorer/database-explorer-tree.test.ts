import { describe, expect, it } from 'vitest'
import {
  databaseExplorerRoots,
  flattenDatabaseExplorer,
  type DatabaseExplorerRow
} from './database-explorer-rows'
import { childNodesFor, connectionNode, introspectTargetFor } from './database-explorer-tree'

const root = connectionNode('conn-0001')

function rowLabel(row: DatabaseExplorerRow): string {
  switch (row.type) {
    case 'group':
      return `group:${row.group}`
    case 'node':
      return row.node.kind === 'connection' ? row.node.connectionId : row.node.kind
    case 'status':
      return row.status
  }
}

describe('database explorer tree', () => {
  const schemas = childNodesFor(root, {
    level: 'schemas',
    schemas: [
      { name: 'public', isCurrent: true },
      { name: 'a/b', isCurrent: false }
    ]
  })
  const [publicSchema, slashSchema] = schemas

  it('keys children uniquely even when names contain slashes', () => {
    expect(new Set(schemas.map((node) => node.key)).size).toBe(2)
    expect(slashSchema?.key).toContain('a%2Fb')
  })

  it('maps each node to the introspection level below it', () => {
    expect(introspectTargetFor(root)).toEqual({ level: 'schemas' })
    expect(introspectTargetFor(publicSchema!)).toEqual({ level: 'relations', schema: 'public' })
  })

  it('shows placeholders for loading, error and empty children', () => {
    const rows = flattenDatabaseExplorer(
      [root],
      { [root.key]: true, [publicSchema!.key]: true, [slashSchema!.key]: true },
      {
        [root.key]: { status: 'loaded', nodes: schemas },
        [publicSchema!.key]: { status: 'loading' },
        [slashSchema!.key]: { status: 'loaded', nodes: [] }
      }
    )
    expect(rows.map(rowLabel)).toEqual(['conn-0001', 'schema', 'loading', 'schema', 'empty'])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 2])
  })

  it('lists groups by name before the ungrouped connections, each in saved order', () => {
    const roots = databaseExplorerRoots([
      { id: 'conn-0001' },
      { id: 'conn-0002', group: 'prod 10' },
      { id: 'conn-0003', group: 'prod 9' },
      { id: 'conn-0004', group: null },
      { id: 'conn-0005', group: 'prod 10' }
    ])
    const rows = flattenDatabaseExplorer(roots, {}, {})
    expect(rows.map(rowLabel)).toEqual([
      'group:prod 9',
      'conn-0003',
      'group:prod 10',
      'conn-0002',
      'conn-0005',
      'conn-0001',
      'conn-0004'
    ])
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 0, 1, 1, 0, 0])
    expect(rows[2]).toMatchObject({ type: 'group', count: 2, expanded: true })
  })

  it('hides a collapsed group’s connections and tags every row with its group', () => {
    const [group, ungrouped] = databaseExplorerRoots([
      { id: 'conn-0001', group: 'prod' },
      { id: 'conn-0002' }
    ])
    const grouped = connectionNode('conn-0001')
    const expanded = { [grouped.key]: true }
    const children = { [grouped.key]: { status: 'loading' as const } }
    const rows = flattenDatabaseExplorer([group!, ungrouped!], expanded, children)
    expect(rows.map((row) => [rowLabel(row), row.depth, row.group])).toEqual([
      ['group:prod', 0, 'prod'],
      ['conn-0001', 1, 'prod'],
      ['loading', 2, 'prod'],
      ['conn-0002', 0, null]
    ])
    const collapsed = flattenDatabaseExplorer(
      [group!, ungrouped!],
      expanded,
      children,
      new Set(['prod'])
    )
    expect(collapsed.map(rowLabel)).toEqual(['group:prod', 'conn-0002'])
    expect(collapsed[0]).toMatchObject({ expanded: false })
  })

  it('hides children of collapsed nodes', () => {
    const rows = flattenDatabaseExplorer(
      [root],
      {},
      {
        [root.key]: { status: 'loaded', nodes: schemas }
      }
    )
    expect(rows).toHaveLength(1)
  })

  it('adds a Routines folder to schemas unless the database has none', () => {
    const relations = {
      level: 'relations' as const,
      relations: [{ name: 't', kind: 'table' as const, comment: null }]
    }
    const withRoutines = childNodesFor(publicSchema!, relations)
    expect(withRoutines.map((node) => node.kind)).toEqual(['relation', 'folder'])
    expect(introspectTargetFor(withRoutines[1]!)).toEqual({ level: 'routines', schema: 'public' })
    expect(childNodesFor(publicSchema!, relations, { routines: false })).toHaveLength(1)
  })

  it('adds Keys and Indexes folders only where the relation kind has them', () => {
    const columns = { level: 'columns' as const, columns: [] }
    const relationOf = (kind: 'table' | 'view' | 'materialized-view') =>
      childNodesFor(publicSchema!, {
        level: 'relations',
        relations: [{ name: 't', kind, comment: null }]
      })[0]!
    const folders = (kind: 'table' | 'view' | 'materialized-view') =>
      childNodesFor(relationOf(kind), columns).map((node) =>
        node.kind === 'folder' ? node.folder : node.kind
      )
    expect(folders('table')).toEqual(['keys', 'indexes'])
    expect(folders('materialized-view')).toEqual(['indexes'])
    expect(folders('view')).toEqual([])
    const [keys] = childNodesFor(relationOf('table'), columns)
    expect(introspectTargetFor(keys!)).toEqual({ level: 'keys', schema: 'public', relation: 't' })
  })

  it('lists databases first when the connection names none, and reads each from its own', () => {
    expect(introspectTargetFor(root, { allDatabases: true })).toEqual({ level: 'databases' })
    const databases = childNodesFor(root, {
      level: 'databases',
      databases: [
        { name: 'app', isCurrent: true },
        { name: 'sales', isCurrent: false }
      ]
    })
    expect(databases.map((node) => node.kind)).toEqual(['database', 'database'])
    const [app, sales] = databases
    expect(introspectTargetFor(sales!)).toEqual({ level: 'schemas', database: 'sales' })

    const schemaIn = (database: typeof app) =>
      childNodesFor(database!, {
        level: 'schemas',
        schemas: [{ name: 'public', isCurrent: true }]
      })[0]!
    // The same schema in two databases is two nodes.
    expect(schemaIn(app).key).not.toBe(schemaIn(sales).key)
    const salesPublic = schemaIn(sales)
    expect(introspectTargetFor(salesPublic)).toEqual({
      level: 'relations',
      database: 'sales',
      schema: 'public'
    })
    const [table, routines] = childNodesFor(salesPublic, {
      level: 'relations',
      relations: [{ name: 't', kind: 'table', comment: null }]
    })
    expect(introspectTargetFor(table!)).toEqual({
      level: 'columns',
      database: 'sales',
      schema: 'public',
      relation: 't'
    })
    expect(introspectTargetFor(routines!)).toEqual({
      level: 'routines',
      database: 'sales',
      schema: 'public'
    })
    const [keys] = childNodesFor(table!, { level: 'columns', columns: [] })
    expect(introspectTargetFor(keys!)).toMatchObject({ level: 'keys', database: 'sales' })
  })

  it('keys unnamed constraints apart by position', () => {
    const table = childNodesFor(publicSchema!, {
      level: 'relations',
      relations: [{ name: 't', kind: 'table', comment: null }]
    })[0]!
    const [keysFolder] = childNodesFor(table, { level: 'columns', columns: [] })
    const unnamed = { name: '', kind: 'foreign' as const, columns: ['a'], references: null }
    const keys = childNodesFor(keysFolder!, { level: 'keys', keys: [unnamed, unnamed] })
    expect(new Set(keys.map((node) => node.key)).size).toBe(2)
    expect(keys.every((node) => node.kind === 'constraint')).toBe(true)
  })
})
